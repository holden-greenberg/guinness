// The Dead Poet Guinness Challenge — single Worker.
//
// Static files in public/ are served directly by the [assets] binding; any
// request that doesn't match a file (the /api/* routes) falls through here.

import { GAMES, GAME_BY_ID } from "./games.js";
import {
  BAR,
  CUISINE_BY_ID,
  haversine,
  walkMinutes,
  mapsUrl,
  orderUrl,
} from "./food.js";

const PEOPLE = ["matt", "alex", "holden"];
const PERSON_SET = new Set(PEOPLE);
const GOAL = 100;
const MAX_PER_SESSION = 99;
const NOTE_MAX = 280;
const QUESTION_MAX = 500;
const CRAVING_MAX = 200;
const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Free, keyless restaurant data for the Food tab. The public Overpass
// instances are frequently overloaded (429/504) or down, so we race all of
// them and fall back to a stale cached result when every one fails.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];
const OVERPASS_UA = "guinness-dead-poet/1.0 (+https://guinness.holdengreenberg.workers.dev)";
const OVERPASS_FRESH_MS = 10 * 60 * 1000; // serve cache without refetch below this
const OVERPASS_KEEP_S = 7 * 24 * 60 * 60; // keep last good result this long for stale fallback
const HUNGER_SET = new Set(["snack", "meal", "feast"]);
const BUDGET_SET = new Set(["low", "mid", "high"]);
const BUDGET_LABEL = { low: "$", mid: "$$", high: "$$$" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
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

      if (pathname === "/api/games" && method === "GET") {
        return json({
          games: GAMES.map((g) => ({ id: g.id, name: g.name, url: g.url })),
        });
      }

      if (pathname === "/api/ask" && method === "POST") {
        const body = await readJson(request);
        const game = GAME_BY_ID.get(body.gameId);
        if (!game) return json({ error: "unknown game" }, 400);
        const question = String(body.question ?? "").trim();
        if (question.length < 3) {
          return json({ error: "ask a fuller question" }, 400);
        }
        if (question.length > QUESTION_MAX) {
          return json({ error: `question too long (max ${QUESTION_MAX})` }, 400);
        }

        const rulesRes = await env.ASSETS.fetch(
          new URL("/rules/" + game.file, request.url)
        );
        const rules = await rulesRes.text();

        const system =
          `You are the rules referee for the card game "${game.name}". ` +
          `Answer the player's question using ONLY the rules text below. ` +
          `Keep it to 1-4 sentences. Quote or cite the specific rule you are ` +
          `relying on. If the rules text does not settle the question, say ` +
          `"The rules provided don't cover that" and, if useful, say what the ` +
          `rules DO say nearby. Never invent a rule.\n\n` +
          `=== ${game.name} RULES ===\n${rules}`;

        let answer;
        try {
          const out = await env.AI.run(AI_MODEL, {
            messages: [
              { role: "system", content: system },
              { role: "user", content: question },
            ],
            max_tokens: 400,
            temperature: 0.2,
          });
          answer = (out.response || "").trim();
        } catch (err) {
          return json({ error: "the AI is unavailable right now", detail: String(err) }, 503);
        }
        if (!answer) return json({ error: "no answer came back" }, 502);
        return json({ game: { id: game.id, name: game.name, url: game.url }, answer });
      }

      if (pathname === "/api/food" && method === "POST") {
        const input = readFoodInput(await readJson(request));

        let elements;
        try {
          elements = await overpassRestaurants(input.maxWalkMin);
        } catch (err) {
          return json(
            { error: "couldn't reach the restaurant map right now", detail: String(err) },
            503
          );
        }

        const candidates = filterCandidates(elements, input);
        const debug = url.searchParams.get("debug");
        if (!candidates.length) {
          return json(
            debug ? { picks: [], _debug: { elements: elements.length, candidates: 0 } } : { picks: [] }
          );
        }

        const exclude = new Set(
          (Array.isArray(input.exclude) ? input.exclude : []).map((s) =>
            String(s).toLowerCase()
          )
        );
        const trimmed = candidates.filter((c) => !exclude.has(c.name.toLowerCase()));
        const shortlist = (trimmed.length ? trimmed : candidates).slice(0, 15);

        let ranked = null;
        let aiErr = null;
        try {
          ranked = await rankWithAI(env, shortlist, input);
        } catch (err) {
          aiErr = String(err && err.message ? err.message : err);
          console.warn("[food] AI rank failed:", aiErr);
        }

        const byName = new Map(shortlist.map((c) => [c.name.toLowerCase(), c]));
        const picks = [];
        for (const r of ranked || []) {
          const c = byName.get(String(r.name || "").toLowerCase());
          if (c && !picks.some((p) => p.name === c.name)) {
            picks.push(shapePick(c, input, String(r.reason || "").slice(0, 200)));
          }
          if (picks.length === 3) break;
        }
        for (const c of shortlist) {
          if (picks.length === 3) break;
          if (!picks.some((p) => p.name === c.name)) {
            picks.push(shapePick(c, input, fallbackReason(c)));
          }
        }
        if (debug) {
          return json({
            picks,
            _debug: {
              elements: elements.length,
              candidates: candidates.length,
              shortlist: shortlist.map((c) => c.name),
              aiRanked: ranked ? ranked.length : null,
              aiErr,
            },
          });
        }
        return json({ picks });
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

/* ------------------------------- Food tab -------------------------------- */

function readFoodInput(body) {
  let maxWalkMin = Number(body.maxWalkMin);
  if (!Number.isFinite(maxWalkMin)) maxWalkMin = 12;
  maxWalkMin = Math.min(25, Math.max(5, Math.round(maxWalkMin)));
  const cuisines = (Array.isArray(body.cuisines) ? body.cuisines : [])
    .map((s) => String(s))
    .filter((s) => CUISINE_BY_ID.has(s))
    .slice(0, 24);
  const budget = (Array.isArray(body.budget) ? body.budget : [])
    .map((s) => String(s))
    .filter((s) => BUDGET_SET.has(s));
  return {
    hunger: HUNGER_SET.has(body.hunger) ? body.hunger : "meal",
    budget,
    maxWalkMin,
    cuisines,
    craving: String(body.craving ?? "").trim().slice(0, CRAVING_MAX),
    exclude: body.exclude,
  };
}

// Restaurants/fast-food/cafés around the bar, from OpenStreetMap. Keyless.
// Fresh result cached 10 min; last good result kept a week and served stale
// if every Overpass mirror is failing (they often are).
async function overpassRestaurants(maxWalkMin) {
  const radius = Math.min(2200, Math.max(1000, maxWalkMin * 80));
  const query =
    `[out:json][timeout:25];` +
    `nwr["amenity"~"^(restaurant|fast_food|cafe)$"](around:${radius},${BAR.lat},${BAR.lng});` +
    `out center 60;`;

  const cache = caches.default;
  const cacheKey = new Request(`https://food.cache/overpass?r=${radius}`);
  const cached = await cache.match(cacheKey);
  const cachedBody = cached ? await cached.json() : null;
  if (cachedBody && Date.now() - (cachedBody.fetchedAt || 0) < OVERPASS_FRESH_MS) {
    return cachedBody.elements;
  }

  try {
    const elements = await raceOverpass(query);
    await cache.put(
      cacheKey,
      new Response(JSON.stringify({ elements, fetchedAt: Date.now() }), {
        headers: {
          "content-type": "application/json",
          "cache-control": `max-age=${OVERPASS_KEEP_S}`,
        },
      })
    );
    return elements;
  } catch (err) {
    if (cachedBody) return cachedBody.elements; // stale, but better than nothing
    throw err;
  }
}

// Hit every mirror at once; take the first that returns usable JSON.
async function raceOverpass(query) {
  const attempts = OVERPASS_ENDPOINTS.map((endpoint) =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": OVERPASS_UA,
      },
      body: "data=" + encodeURIComponent(query),
      signal: AbortSignal.timeout(20000),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`${endpoint} → HTTP ${res.status}`);
      const data = await res.json();
      // A healthy mirror near a dense area returns dozens; a broken/empty
      // mirror answers fast with []. Don't let that win the race.
      if (!Array.isArray(data.elements) || data.elements.length < 5) {
        throw new Error(`${endpoint} → thin result (${data.elements?.length ?? "none"})`);
      }
      return data.elements;
    })
  );
  return Promise.any(attempts);
}

function filterCandidates(elements, input) {
  const now = nycNow();
  const wanted = new Set(
    input.cuisines.flatMap((id) => CUISINE_BY_ID.get(id).match)
  );
  const seen = new Set();
  const out = [];

  for (const el of elements) {
    const tags = el.tags || {};
    const name = String(tags.name || "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;

    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;

    const meters = haversine(BAR, { lat, lng });
    const walkMin = walkMinutes(meters);
    const delivers = tags.delivery === "yes";
    if (walkMin > input.maxWalkMin && !delivers) continue;

    let hours = "unknown";
    if (tags.opening_hours) {
      const open = openNow(tags.opening_hours, now);
      if (open === false) continue;
      if (open === true) hours = "open";
    }

    const cuisineParts = String(tags.cuisine || "")
      .toLowerCase()
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    if (wanted.size && !cuisineParts.some((p) => wanted.has(p))) continue;

    seen.add(name.toLowerCase());
    out.push({
      name,
      lat,
      lng,
      meters,
      walkMin,
      delivers,
      hours,
      amenity: tags.amenity || "restaurant",
      phone: tags.phone || tags["contact:phone"] || null,
      cuisineParts,
      cuisineLabel: prettyCuisine(cuisineParts, tags.amenity),
    });
  }

  out.sort((a, b) => a.meters - b.meters);
  return out;
}

function prettyCuisine(parts, amenity) {
  if (parts.length) {
    return parts
      .slice(0, 2)
      .map((p) =>
        p.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
      )
      .join(", ");
  }
  if (amenity === "cafe") return "Café";
  if (amenity === "fast_food") return "Fast food";
  return "Restaurant";
}

function shapePick(c, input, reason) {
  const modes = [];
  if (c.walkMin <= input.maxWalkMin) modes.push("walk");
  if (c.delivers) modes.push("delivery");
  if (!modes.length) modes.push("walk");
  return {
    name: c.name,
    cuisine: c.cuisineLabel,
    walkMin: c.walkMin,
    modes,
    hours: c.hours,
    reason,
    mapsUrl: mapsUrl(c.name, c.lat, c.lng),
    orderUrl: orderUrl(c.name),
    phone: c.phone,
  };
}

function fallbackReason(c) {
  const bits = [`${c.walkMin} min walk`];
  if (c.cuisineParts.length) bits.push(c.cuisineLabel.toLowerCase());
  if (c.delivers) bits.push("delivers");
  const s = bits.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function rankWithAI(env, shortlist, input) {
  const cuisineLabels =
    input.cuisines.map((id) => CUISINE_BY_ID.get(id).label).join(", ") || "any";
  const budgetLabels =
    input.budget.map((id) => BUDGET_LABEL[id]).join(" / ") || "any";
  const lines = shortlist
    .map(
      (c, i) =>
        `${i + 1}. ${c.name} | ${c.cuisineLabel} | ${c.amenity} | ${c.walkMin} min walk | delivers: ${c.delivers ? "y" : "n"} | hours: ${c.hours}`
    )
    .join("\n");

  const system =
    `You help three friends at a bar pick where to get dinner. From the ` +
    `numbered candidate list, choose exactly 3 and rank them best first for ` +
    `these constraints:\n` +
    `- hunger: ${input.hunger}\n` +
    `- budget: ${budgetLabels}\n` +
    `- cuisines wanted: ${cuisineLabels}\n` +
    `- craving: ${input.craving || "(none stated)"}\n` +
    `- max walk: ${input.maxWalkMin} min (delivery options may be farther)\n\n` +
    `Reply with ONLY a JSON array of exactly 3 objects, each ` +
    `{"name": "<exact name from the list>", "reason": "<max 140 chars, plain ` +
    `and practical, name the deciding factor>"}. Pick only from the list. ` +
    `Never invent a place.\n\nCANDIDATES:\n${lines}`;

  const out = await env.AI.run(AI_MODEL, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: "Give me the 3 picks as JSON." },
    ],
    max_tokens: 500,
    temperature: 0.3,
  });

  const text = (out.response || "").trim();
  const slice = extractJsonArray(text);
  if (!slice) throw new Error("no JSON array in AI reply: " + text.slice(0, 160));

  let arr;
  try {
    arr = JSON.parse(slice);
  } catch (e) {
    throw new Error("bad JSON from AI: " + slice.slice(0, 160));
  }
  if (!Array.isArray(arr) && Array.isArray(arr?.picks)) arr = arr.picks;
  if (!Array.isArray(arr)) throw new Error("AI reply was not an array");

  const picks = arr
    .filter((x) => x && typeof x.name === "string")
    .map((x) => ({ name: x.name, reason: String(x.reason || "") }));
  if (!picks.length) throw new Error("AI array had no usable picks");
  return picks;
}

// First balanced [ ... ] in a string (handles trailing prose / code fences).
function extractJsonArray(text) {
  const start = text.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

// Current weekday + minutes-past-midnight in the bar's timezone.
function nycNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  const dayIdx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = parseInt(parts.hour, 10) % 24;
  return { dow: dayIdx[parts.weekday], minutes: hour * 60 + parseInt(parts.minute, 10) };
}

// Best-effort OSM opening_hours check. true = open, false = closed,
// null = couldn't tell (caller keeps the place, marked "unknown").
function openNow(spec, cur) {
  try {
    const s = spec.trim().toLowerCase().replace(/\s+/g, " ");
    if (s === "24/7") return true;
    const DAY = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
    let sawToday = false;

    for (const raw of s.split(";")) {
      const block = raw.trim();
      if (!block) continue;

      const off = block.match(/^([a-z, \-]+?) (off|closed)$/);
      if (off) {
        if (dayMatches(off[1], cur.dow, DAY)) sawToday = true;
        continue;
      }

      const timeRe = /\d{1,2}:\d{2}-\d{1,2}:\d{2}(?:,\d{1,2}:\d{2}-\d{1,2}:\d{2})*/;
      const withDay = block.match(new RegExp("^([a-z, \\-]+?) (" + timeRe.source + ")$"));
      const timeOnly = block.match(new RegExp("^(" + timeRe.source + ")$"));

      let ranges;
      if (withDay) {
        if (!dayMatches(withDay[1], cur.dow, DAY)) continue;
        ranges = withDay[2];
      } else if (timeOnly) {
        ranges = timeOnly[1];
      } else {
        continue;
      }

      sawToday = true;
      for (const range of ranges.split(",")) {
        const [a, b] = range.split("-");
        const start = hm(a);
        let end = hm(b);
        if (end <= start) end += 1440; // over midnight
        const t = cur.minutes;
        if ((t >= start && t < end) || (t + 1440 >= start && t + 1440 < end)) {
          return true;
        }
      }
    }
    return sawToday ? false : null;
  } catch {
    return null;
  }
}

function hm(x) {
  const [h, m] = x.split(":").map((n) => parseInt(n, 10));
  return h * 60 + m;
}

function dayMatches(daySpec, dow, DAY) {
  for (const token of daySpec.split(",")) {
    const t = token.trim();
    if (!t) continue;
    const range = t.match(/^([a-z]{2})-([a-z]{2})$/);
    if (range) {
      const a = DAY[range[1]];
      const b = DAY[range[2]];
      if (a == null || b == null) continue;
      for (let d = a, i = 0; i < 7; d = (d + 1) % 7, i++) {
        if (d === dow) return true;
        if (d === b) break;
      }
    } else if (DAY[t] === dow) {
      return true;
    }
  }
  return false;
}
