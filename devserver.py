#!/usr/bin/env python3
"""Local preview server for the Guinness Challenge app.

This is a DEV-ONLY shim. Production runs on Cloudflare Pages + D1 (see README);
that stack needs the Wrangler CLI (Node.js). This script uses only the Python
standard library so the app can be previewed on a machine without Node.

It serves the static site from public/ and reimplements the four API routes
from src/worker.js against a local SQLite file (.dev.sqlite, git-ignored),
seeded from schema.sql on first run.

    python3 devserver.py [--port 8788]
"""

import argparse
import json
import re
import sqlite3
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
PUBLIC = ROOT / "public"
DB_PATH = ROOT / ".dev.sqlite"
SCHEMA = ROOT / "schema.sql"
GOAL = 100

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}

# mirrors src/games.js
GAMES = [
    {"id": "99", "name": "99 (Ninety-Nine)",
     "url": "https://bicyclecards.com/how-to-play/99-ninety-nine",
     "file": "99.txt"},
    {"id": "egyptian-rat-screw", "name": "Egyptian Rat Screw",
     "url": "https://bicyclecards.com/how-to-play/egyptian-rat-screw",
     "file": "egyptian-rat-screw.txt"},
    {"id": "monopoly-deal", "name": "Monopoly Deal",
     "url": "https://monopolydealrules.com/index.php?page=general",
     "file": "monopoly-deal.txt"},
]
GAME_BY_ID = {g["id"]: g for g in GAMES}


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = db()
    have = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='people'"
    ).fetchone()
    if not have:
        conn.executescript(SCHEMA.read_text())
        conn.commit()
        print(f"seeded {DB_PATH.name} from {SCHEMA.name}")
    conn.close()


PEOPLE = ["matt", "alex", "holden"]
PERSON_SET = set(PEOPLE)
MAX_PER_SESSION = 99
NOTE_MAX = 280


def _tonight_since(conn):
    row = conn.execute(
        "SELECT value FROM meta WHERE key = 'tonight_since'"
    ).fetchone()
    return row["value"] if row else "1970-01-01T00:00:00.000Z"


def get_state():
    conn = db()
    since = _tonight_since(conn)
    sums = conn.execute(
        "SELECT COALESCE(SUM(matt),0) matt, COALESCE(SUM(alex),0) alex, "
        "COALESCE(SUM(holden),0) holden FROM sessions"
    ).fetchone()
    people = []
    for p in conn.execute("SELECT * FROM people ORDER BY sort"):
        app_count = conn.execute(
            "SELECT COUNT(*) c FROM drinks WHERE person_id = ?", (p["id"],)
        ).fetchone()["c"]
        tonight = conn.execute(
            "SELECT COUNT(*) c FROM drinks WHERE person_id = ? AND created_at >= ?",
            (p["id"], since),
        ).fetchone()["c"]
        people.append({
            "id": p["id"],
            "name": p["name"],
            "lifetime": p["lifetime_start"] + sums[p["id"]] + app_count,
            "tonight": tonight,
        })
    conn.close()
    return {
        "goal": GOAL,
        "tonightSince": since,
        "tonightTotal": sum(p["tonight"] for p in people),
        "people": people,
    }


def get_history():
    conn = db()
    sessions = [
        dict(r)
        for r in conn.execute(
            "SELECT id, date, matt, alex, holden, note FROM sessions ORDER BY date, id"
        )
    ]
    names = [dict(r) for r in conn.execute(
        "SELECT id, name FROM people ORDER BY sort"
    )]
    conn.close()
    totals = {k: sum(s[k] for s in sessions) for k in PEOPLE}
    return {"people": names, "sessions": sessions, "totals": totals}


def _clean_session(body):
    date = str(body.get("date", ""))
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        return None, "date must be YYYY-MM-DD"
    out = {"date": date, "note": str(body.get("note", ""))[:NOTE_MAX]}
    for pid in PEOPLE:
        try:
            n = int(body.get(pid))
        except (TypeError, ValueError):
            return None, f"{pid} count must be an integer"
        if n < 0 or n > MAX_PER_SESSION:
            return None, f"{pid} count must be 0-{MAX_PER_SESSION}"
        out[pid] = n
    return out, None


def add_session(body):
    c, err = _clean_session(body)
    if err:
        return err
    conn = db()
    conn.execute(
        "INSERT INTO sessions (date, matt, alex, holden, note) VALUES (?,?,?,?,?)",
        (c["date"], c["matt"], c["alex"], c["holden"], c["note"]),
    )
    conn.commit()
    conn.close()
    return None


def update_session(body):
    try:
        sid = int(body.get("id"))
    except (TypeError, ValueError):
        return "bad id"
    c, err = _clean_session(body)
    if err:
        return err
    conn = db()
    cur = conn.execute(
        "UPDATE sessions SET date=?, matt=?, alex=?, holden=?, note=? WHERE id=?",
        (c["date"], c["matt"], c["alex"], c["holden"], c["note"], sid),
    )
    conn.commit()
    changed = cur.rowcount
    conn.close()
    return None if changed else "not found"


def delete_session(body):
    try:
        sid = int(body.get("id"))
    except (TypeError, ValueError):
        return "bad id"
    conn = db()
    conn.execute("DELETE FROM sessions WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return None


def log_tonight():
    conn = db()
    since = _tonight_since(conn)
    counts = {
        pid: conn.execute(
            "SELECT COUNT(*) c FROM drinks WHERE person_id=? AND created_at>=?",
            (pid, since),
        ).fetchone()["c"]
        for pid in PEOPLE
    }
    if all(v == 0 for v in counts.values()):
        conn.close()
        return "nothing to log tonight"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    conn.execute(
        "INSERT INTO sessions (date, matt, alex, holden, note) VALUES (?,?,?,?,'')",
        (today, counts["matt"], counts["alex"], counts["holden"]),
    )
    conn.execute("DELETE FROM drinks WHERE created_at >= ?", (since,))
    conn.execute(
        "UPDATE meta SET value = ? WHERE key = 'tonight_since'", (now_iso(),)
    )
    conn.commit()
    conn.close()
    return None


def add_drink(person):
    conn = db()
    conn.execute(
        "INSERT INTO drinks (person_id, created_at) VALUES (?, ?)",
        (person, now_iso()),
    )
    conn.commit()
    conn.close()


def undo_drink(person):
    conn = db()
    conn.execute(
        "DELETE FROM drinks WHERE id = "
        "(SELECT id FROM drinks WHERE person_id = ? ORDER BY id DESC LIMIT 1)",
        (person,),
    )
    conn.commit()
    conn.close()


def reset_tonight():
    conn = db()
    conn.execute(
        "UPDATE meta SET value = ? WHERE key = 'tonight_since'", (now_iso(),)
    )
    conn.commit()
    conn.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "GuinnessDev/1.0"

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("content-length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return {}

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/state":
            return self._send_json(get_state())
        if path == "/api/history":
            return self._send_json(get_history())
        if path == "/api/games":
            return self._send_json({
                "games": [
                    {"id": g["id"], "name": g["name"], "url": g["url"]}
                    for g in GAMES
                ]
            })
        return self._serve_static(path)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/drink":
            person = self._read_json().get("person")
            if person not in PERSON_SET:
                return self._send_json({"error": "unknown person"}, 400)
            add_drink(person)
            return self._send_json(get_state())
        if path == "/api/undo":
            person = self._read_json().get("person")
            if person not in PERSON_SET:
                return self._send_json({"error": "unknown person"}, 400)
            undo_drink(person)
            return self._send_json(get_state())
        if path == "/api/reset-tonight":
            reset_tonight()
            return self._send_json(get_state())
        if path == "/api/log-tonight":
            err = log_tonight()
            if err:
                return self._send_json({"error": err}, 400)
            return self._send_json(get_state())
        if path == "/api/history":
            err = add_session(self._read_json())
            if err:
                return self._send_json({"error": err}, 400)
            return self._send_json(get_history())
        if path == "/api/ask":
            body = self._read_json()
            game = GAME_BY_ID.get(body.get("gameId"))
            if not game:
                return self._send_json({"error": "unknown game"}, 400)
            q = str(body.get("question", "")).strip()
            if len(q) < 3:
                return self._send_json({"error": "ask a fuller question"}, 400)
            # Workers AI only runs on the deployed site; stub it locally.
            return self._send_json({
                "game": {"id": game["id"], "name": game["name"], "url": game["url"]},
                "answer": "(local dev) The AI rules answer only runs on the "
                          "deployed Cloudflare site. Your question reached the "
                          f"server fine for \"{game['name']}\".",
            })
        return self._send_json({"error": "not found"}, 404)

    def do_PATCH(self):
        if self.path.split("?", 1)[0] == "/api/history":
            err = update_session(self._read_json())
            if err:
                return self._send_json({"error": err}, 400 if err != "not found" else 404)
            return self._send_json(get_history())
        return self._send_json({"error": "not found"}, 404)

    def do_DELETE(self):
        if self.path.split("?", 1)[0] == "/api/history":
            err = delete_session(self._read_json())
            if err:
                return self._send_json({"error": err}, 400)
            return self._send_json(get_history())
        return self._send_json({"error": "not found"}, 404)

    def _serve_static(self, path):
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        if not re.fullmatch(r"[A-Za-z0-9_./-]+", rel) or ".." in rel:
            return self._send_json({"error": "bad path"}, 400)
        target = (PUBLIC / rel).resolve()
        # match Cloudflare's html_handling: "/history" -> "/history.html"
        if not target.is_file() and (PUBLIC / (rel + ".html")).is_file():
            target = (PUBLIC / (rel + ".html")).resolve()
        if not str(target).startswith(str(PUBLIC.resolve())) or not target.is_file():
            target = PUBLIC / "index.html"  # fallback
        data = target.read_bytes()
        self.send_response(200)
        self.send_header(
            "content-type",
            CONTENT_TYPES.get(target.suffix, "application/octet-stream"),
        )
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8788)
    args = ap.parse_args()
    init_db()
    httpd = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"Guinness dev server on http://localhost:{args.port}  (Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
