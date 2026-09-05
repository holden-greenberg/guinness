import { getState, json } from "./_lib.js";

// POST /api/reset-tonight — start a fresh session. Lifetime totals are
// untouched; only the "tonight" counters go back to zero.
export async function onRequestPost({ env }) {
  await env.DB
    .prepare("UPDATE meta SET value = ?1 WHERE key = 'tonight_since'")
    .bind(new Date().toISOString())
    .run();

  return json(await getState(env));
}
