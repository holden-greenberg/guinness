// Shared helpers for the API routes. The leading underscore keeps Cloudflare
// Pages from treating this file as its own route.

export const PEOPLE = new Set(["matt", "alex", "holden"]);

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// Full app state in one shot: every person's lifetime total + tonight count,
// the session total, and when "tonight" started.
export async function getState(env) {
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
    goal: 100,
    tonightSince: since,
    tonightTotal: people.reduce((sum, p) => sum + p.tonight, 0),
    people,
  };
}
