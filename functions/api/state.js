import { getState, json } from "./_lib.js";

// GET /api/state — current counts for all three drinkers.
export async function onRequestGet({ env }) {
  return json(await getState(env));
}
