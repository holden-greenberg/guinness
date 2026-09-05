import { getState, json, PEOPLE } from "./_lib.js";

// POST /api/undo  { "person": "matt" } — remove that person's most recent
// logged Guinness (fixes a mis-tap). Returns fresh state.
export async function onRequestPost({ env, request }) {
  const body = await request.json().catch(() => ({}));
  const person = body.person;
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
