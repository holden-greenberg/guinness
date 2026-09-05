#!/usr/bin/env python3
"""Local preview server for the Guinness Challenge app.

This is a DEV-ONLY shim. Production runs on Cloudflare Pages + D1 (see README);
that stack needs the Wrangler CLI (Node.js). This script uses only the Python
standard library so the app can be previewed on a machine without Node.

It serves the static site from public/ and reimplements the four API routes
from functions/api/ against a local SQLite file (.dev.sqlite, git-ignored),
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
}


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


def get_state():
    conn = db()
    row = conn.execute(
        "SELECT value FROM meta WHERE key = 'tonight_since'"
    ).fetchone()
    since = row["value"] if row else "1970-01-01T00:00:00.000Z"
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
            "lifetime": p["lifetime_start"] + app_count,
            "tonight": tonight,
        })
    conn.close()
    return {
        "goal": GOAL,
        "tonightSince": since,
        "tonightTotal": sum(p["tonight"] for p in people),
        "people": people,
    }


PEOPLE = {"matt", "alex", "holden"}


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
        return self._serve_static(path)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/drink":
            person = self._read_json().get("person")
            if person not in PEOPLE:
                return self._send_json({"error": "unknown person"}, 400)
            add_drink(person)
            return self._send_json(get_state())
        if path == "/api/undo":
            person = self._read_json().get("person")
            if person not in PEOPLE:
                return self._send_json({"error": "unknown person"}, 400)
            undo_drink(person)
            return self._send_json(get_state())
        if path == "/api/reset-tonight":
            reset_tonight()
            return self._send_json(get_state())
        return self._send_json({"error": "not found"}, 404)

    def _serve_static(self, path):
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        if not re.fullmatch(r"[A-Za-z0-9_./-]+", rel) or ".." in rel:
            return self._send_json({"error": "bad path"}, 400)
        target = (PUBLIC / rel).resolve()
        if not str(target).startswith(str(PUBLIC.resolve())) or not target.is_file():
            target = PUBLIC / "index.html"  # SPA-ish fallback
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
