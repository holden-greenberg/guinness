// The Dead Poet Guinness Challenge — single Worker.
//
// Static files in public/ are served directly by the [assets] binding; any
// request that doesn't match a file (the /api/* routes) falls through here.

import { GAMES, GAME_BY_ID } from "./games.js";
import {
  CUISINE_BY_ID,
  MOODS,
  WALK_DEFAULT,
  WALK_MAX,
  WALK_MIN,
  directionsUrl,
  menuSearchUrl,
  orderUrl,
  reviewsUrl,
} from "./food.js";
import RESTAURANTS from "./restaurants.json";

const PEOPLE = ["matt", "alex", "holden"];
const PERSON_SET = new Set(PEOPLE);
const GOAL = 100;
const MAX_PER_SESSION = 99;
const NOTE_MAX = 280;
const QUESTION_MAX = 500;
const FOOD_QUERY_MAX = 60;
const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const MOOD_SET = new Set(MOODS.map((m) => m.id));
const FOOD_POOL_SIZE = 30; // the page swaps from these without another request
const EVENING_MINUTES = 15 * 60; // daytime-only spots drop out from 3pm

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
        // Lifetime counts every drinks row, including taps from before tonight_since,
        // so clear them all or they stay in the counter total but never reach history.
        await env.DB.prepare("DELETE FROM drinks").run();
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
        return json({ picks: foodPool(input).map((c) => shapePick(c, input)) });
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
  if (!Number.isFinite(maxWalkMin)) maxWalkMin = WALK_DEFAULT;
  maxWalkMin = Math.min(WALK_MAX, Math.max(WALK_MIN, Math.round(maxWalkMin)));
  const cuisines = (Array.isArray(body.cuisines) ? body.cuisines : [])
    .map((s) => String(s))
    .filter((s) => CUISINE_BY_ID.has(s));
  return {
    mood: MOOD_SET.has(body.mood) ? body.mood : null,
    cuisines,
    query: String(body.query ?? "").trim().toLowerCase().slice(0, FOOD_QUERY_MAX),
    maxWalkMin,
    eatOut: body.eatOut === true,
  };
}

// Everything that fits, close places more likely to come first but not always,
// so each visit offers something different and the distance setting matters.
function foodPool(input) {
  const now = nycNow();
  const askedForIt = input.cuisines.length > 0 || input.query.length > 0;
  const fits = [];

  for (const place of RESTAURANTS.places) {
    if (place.walkMin > input.maxWalkMin) continue;
    if (input.mood && !place.moods.includes(input.mood)) continue;
    if (input.cuisines.length && !input.cuisines.some((id) => place.chips.includes(id))) continue;
    if (input.query && !matchesQuery(place, input.query)) continue;

    if (!askedForIt) {
      if (place.snack) continue;
      if (!input.eatOut && !place.portable) continue;
      if (place.daytime && !place.hours && now.minutes >= EVENING_MINUTES) continue;
    }

    const today = place.hours ? hoursToday(place.hours, now) : null;
    if (today && !today.open) continue;
    fits.push({ ...place, hoursLabel: hoursLabel(today), order: place.walkMin + Math.random() * 6 });
  }
  return fits.sort((a, b) => a.order - b.order).slice(0, FOOD_POOL_SIZE);
}

function matchesQuery(place, query) {
  const labels = place.chips.map((id) => CUISINE_BY_ID.get(id).label);
  return [place.name, place.cuisine, ...labels].join(" ").toLowerCase().includes(query);
}

function hoursLabel(today) {
  if (!today) return "Hours not on file";
  if (today.closes == null) return "Open 24 hours";
  const minutes = today.closes % 1440;
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, "0");
  const clock = `${h % 12 || 12}${m === "00" ? "" : ":" + m}`;
  return `Open until ${clock} ${h < 12 ? "AM" : "PM"}`;
}

function shapePick(c, input) {
  return {
    name: c.name,
    cuisine: c.cuisine,
    address: c.address,
    grade: c.grade,
    walkMin: c.walkMin,
    eatOut: input.eatOut,
    hours: c.hoursLabel,
    delivers: c.delivers,
    phone: c.phone,
    menuUrl: c.website || menuSearchUrl(c.name),
    orderUrl: orderUrl(c.name),
    directionsUrl: directionsUrl(c.name, c.address),
    reviewsUrl: reviewsUrl(c.name, c.address),
  };
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

// Best-effort OSM opening_hours check: { open, closes } with closes in minutes
// past midnight (null if it never closes), or null if we couldn't tell.
function hoursToday(spec, cur) {
  try {
    const s = spec.trim().toLowerCase().replace(/\s+/g, " ");
    if (s === "24/7") return { open: true, closes: null };
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
          return { open: true, closes: end };
        }
      }
    }
    return sawToday ? { open: false } : null;
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
