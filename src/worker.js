// The Dead Poet Guinness Challenge — single Worker.
//
// Static files in public/ are served directly by the [assets] binding; any
// request that doesn't match a file (i.e. /api/*) falls through to here.

const PEOPLE = new Set(["matt", "alex", "holden"]);
const GOAL = 100;

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
        if (!PEOPLE.has(person)) return json({ error: "unknown person" }, 400);
        await env.DB
          .prepare("INSERT INTO drinks (person_id, created_at) VALUES (?1, ?2)")
          .bind(person, new Date().toISOString())
          .run();
        return json(await getState(env));
      }

      if (pathname === "/api/undo" && method === "POST") {
        const person = (await readJson(request)).person;
        if (!PEOPLE.has(person)) return json({ error: "unknown person" }, 400);
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

// Full app state in one shot: each person's lifetime total + tonight count,
// the session total, and when "tonight" started.
async function getState(env) {
  const sinceRow = await env.DB
    .prepare("SELECT value FROM meta WHERE key = 'tonight_since'")
    .first();
  const since = sinceRow?.value ?? "1970-01-01T00:00:00.000Z";

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
    lifetime: r.lifetime_start + r.app_count,
    tonight: r.tonight,
  }));

  return {
    goal: GOAL,
    tonightSince: since,
    tonightTotal: people.reduce((sum, p) => sum + p.tonight, 0),
    people,
  };
}
