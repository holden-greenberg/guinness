import { getState, json, PEOPLE } from "./_lib.js";

// POST /api/drink  { "person": "matt" } — log one Guinness. Returns fresh state.
export async function onRequestPost({ env, request }) {
  const body = await request.json().catch(() => ({}));
  const person = body.person;
  if (!PEOPLE.has(person)) return json({ error: "unknown person" }, 400);

  await env.DB
    .prepare("INSERT INTO drinks (person_id, created_at) VALUES (?1, ?2)")
    .bind(person, new Date().toISOString())
    .run();

  return json(await getState(env));
}
