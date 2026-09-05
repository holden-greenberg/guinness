// The Dead Poet Guinness Challenge — single Worker.
//
// Static files in public/ are served directly by the [assets] binding; any
// request that doesn't match a file (the /api/* routes) falls through here.

const PEOPLE = ["matt", "alex", "holden"];
const PERSON_SET = new Set(PEOPLE);
const GOAL = 100;
const MAX_PER_SESSION = 99;
const NOTE_MAX = 280;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = request.method;

    try {
      if (pathname === "/api/state" && method === "GET") {
        return json(await getState(env));
      }

      if (pathname === "/api/drink" && method === "POST") {
        const person = (await readJson(request)).person;
        if (!PERSON_SET.has(person)) return json({ error: "unknown person" }, 400);
        await env.DB
          .prepare("INSERT INTO drinks (person_id, created_at) VALUES (?1, ?2)")
          .bind(person, new Date().toISOString())
          .run();
        return json(await getState(env));
      }

      if (pathname === "/api/undo" && method === "POST") {
        const person = (await readJson(request)).person;
        if (!PERSON_SET.has(person)) return json({ error: "unknown person" }, 400);
        await env.DB
          .prepare(
            `DELETE FROM drinks
              WHERE id = (SELECT id FROM drinks
                           WHERE person_id = ?1
                           ORDER BY id DESC
                           LIMIT 1)`
          )
          .bind(person)
          .run();
        return json(await getState(env));
      }

      if (pathname === "/api/reset-tonight" && method === "POST") {
        await env.DB
          .prepare("UPDATE meta SET value = ?1 WHERE key = 'tonight_since'")
          .bind(new Date().toISOString())
          .run();
        return json(await getState(env));
      }

      // Roll the current night's live taps into a dated sessions row.
      if (pathname === "/api/log-tonight" && method === "POST") {
        const since = await tonightSince(env);
        const counts = {};
        for (const id of PEOPLE) {
          const row = await env.DB
            .prepare(
              "SELECT COUNT(*) AS c FROM drinks WHERE person_id = ?1 AND created_at >= ?2"
            )
            .bind(id, since)
            .first();
          counts[id] = row.c;
        }
        if (PEOPLE.every((id) => counts[id] === 0)) {
          return json({ error: "nothing to log tonight" }, 400);
        }
        const today = new Date().toISOString().slice(0, 10);
        await env.DB
          .prepare(
            "INSERT INTO sessions (date, matt, alex, holden, note) VALUES (?1, ?2, ?3, ?4, '')"
          )
          .bind(today, counts.matt, counts.alex, counts.holden)
          .run();
        await env.DB
          .prepare("DELETE FROM drinks WHERE created_at >= ?1")
          .bind(since)
          .run();
        await env.DB
          .prepare("UPDATE meta SET value = ?1 WHERE key = 'tonight_since'")
          .bind(new Date().toISOString())
          .run();
        return json(await getState(env));
      }

      if (pathname === "/api/history") {
        if (method === "GET") {
          return json(await getHistory(env));
        }

        if (method === "POST") {
          const body = await readJson(request);
          const clean = validateSession(body);
          if (clean.error) return json({ error: clean.error }, 400);
          await env.DB
            .prepare(
              "INSERT INTO sessions (date, matt, alex, holden, note) VALUES (?1, ?2, ?3, ?4, ?5)"
            )
            .bind(clean.date, clean.matt, clean.alex, clean.holden, clean.note)
            .run();
          return json(await getHistory(env));
        }

        if (method === "PATCH") {
          const body = await readJson(request);
          const id = Number(body.id);
          if (!Number.isInteger(id) || id <= 0) {
            return json({ error: "bad id" }, 400);
          }
          const clean = validateSession(body);
          if (clean.error) return json({ error: clean.error }, 400);
          const res = await env.DB
            .prepare(
              "UPDATE sessions SET date = ?1, matt = ?2, alex = ?3, holden = ?4, note = ?5 WHERE id = ?6"
            )
            .bind(clean.date, clean.matt, clean.alex, clean.holden, clean.note, id)
            .run();
          if (!res.meta.changes) return json({ error: "not found" }, 404);
          return json(await getHistory(env));
        }

        if (method === "DELETE") {
          const id = Number((await readJson(request)).id);
          if (!Number.isInteger(id) || id <= 0) {
            return json({ error: "bad id" }, 400);
          }
          await env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(id).run();
          return json(await getHistory(env));
        }

        return json({ error: "method not allowed" }, 405);
      }
    } catch (err) {
      return json({ error: "server error", detail: String(err) }, 500);
    }

    return json({ error: "not found" }, 404);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function tonightSince(env) {
  const row = await env.DB
    .prepare("SELECT value FROM meta WHERE key = 'tonight_since'")
    .first();
  return row?.value ?? "1970-01-01T00:00:00.000Z";
}

function validateSession(body) {
  const date = String(body.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return { error: "date must be YYYY-MM-DD" };
  }
  const out = { date, note: String(body.note ?? "").slice(0, NOTE_MAX) };
  for (const id of PEOPLE) {
    const n = Number(body[id]);
    if (!Number.isInteger(n) || n < 0 || n > MAX_PER_SESSION) {
      return { error: `${id} count must be 0-${MAX_PER_SESSION}` };
    }
    out[id] = n;
  }
  return out;
}

// Each person's lifetime total + tonight count, the session total, goal.
async function getState(env) {
  const since = await tonightSince(env);
  const sums = await env.DB
    .prepare(
      `SELECT COALESCE(SUM(matt), 0) AS matt,
              COALESCE(SUM(alex), 0) AS alex,
              COALESCE(SUM(holden), 0) AS holden
         FROM sessions`
    )
    .first();

  const { results } = await env.DB
    .prepare(
      `SELECT p.id, p.name, p.lifetime_start,
              (SELECT COUNT(*) FROM drinks d WHERE d.person_id = p.id) AS app_count,
              (SELECT COUNT(*) FROM drinks d
                 WHERE d.person_id = p.id AND d.created_at >= ?1) AS tonight
         FROM people p
        ORDER BY p.sort`
    )
    .bind(since)
    .all();

  const people = results.map((r) => ({
    id: r.id,
    name: r.name,
    lifetime: r.lifetime_start + (sums[r.id] ?? 0) + r.app_count,
    tonight: r.tonight,
  }));

  return {
    goal: GOAL,
    tonightSince: since,
    tonightTotal: people.reduce((sum, p) => sum + p.tonight, 0),
    people,
  };
}

// All sessions oldest-first, plus per-person totals and names for the header.
async function getHistory(env) {
  const { results } = await env.DB
    .prepare("SELECT id, date, matt, alex, holden, note FROM sessions ORDER BY date, id")
    .all();
  const { results: nameRows } = await env.DB
    .prepare("SELECT id, name FROM people ORDER BY sort")
    .all();

  const totals = { matt: 0, alex: 0, holden: 0 };
  for (const s of results) {
    totals.matt += s.matt;
    totals.alex += s.alex;
    totals.holden += s.holden;
  }

  return {
    people: nameRows.map((r) => ({ id: r.id, name: r.name })),
    sessions: results,
    totals,
  };
}
