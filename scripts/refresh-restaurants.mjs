// Rebuilds src/restaurants.json, the Food tab's restaurant list. Runs by itself
// every month (.github/workflows/refresh-restaurants.yml), so nobody is watching:
// it must never replace a good list with a worse one.
//
// The app never calls these services at request time, so an outage here can
// only delay a refresh, never break the tab. Both sources are free and keyless:
//   - NYC health-inspection open data: who exists, cuisine, address, phone, grade
//   - OpenStreetMap main API: opening hours and delivery, where someone tagged them

import { readFileSync, writeFileSync } from "node:fs";
import {
  BAR,
  CUISINES,
  DAYTIME_CUISINES,
  DAYTIME_NAME,
  MOODS,
  NOT_PORTABLE_NAME,
  PORTABLE_CHIPS,
  PORTABLE_CUISINES,
  SNACK_KINDS,
  WALK_MAX,
  haversine,
  walkMinutes,
} from "../src/food.js";

const OUT = new URL("../src/restaurants.json", import.meta.url);
const UA = "guinness-dead-poet/1.0 (+https://guinness.holdengreenberg.workers.dev)";
const RADIUS_M = 1600; // a little past the longest walk the slider allows
const MIN_SHARE_OF_PREVIOUS = 0.7; // losing more than this means the download went wrong

// Inspected more than this long ago usually means it quietly closed.
const MAX_INSPECTION_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const SKIP_CUISINES = new Set(["Bottled Beverages", "Not Listed/Not Applicable"]);
// Permitted food service that isn't somewhere you'd go for dinner from a bar.
const SKIP_NAMES =
  /dead poet|\b(inns?|suites|hotel|theatres?|dining hall|museum|school|hospital|church|ymca)\b/i;

// Shouty city records -> readable names.
const KEEP_UPPER = /^(UWS|UES|NYC|BBQ|AMC|KFC|II|III)$/;
function titleCase(s) {
  return s
    .toLowerCase()
    .replace(/[a-z0-9]+(?:['’][a-z]+)?/g, (w) => {
      if (KEEP_UPPER.test(w.toUpperCase())) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .replace(/\bMc([a-z])/g, (_, c) => "Mc" + c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

function chipsFor(name, cuisine) {
  return CUISINES.filter(
    (c) => c.match.includes(cuisine) || (c.name && new RegExp(c.name, "i").test(name))
  ).map((c) => c.id);
}

function isPortable(place, tags = {}) {
  if (tags.takeaway === "yes" || tags.takeaway === "only" || tags.amenity === "fast_food") return true;
  if (tags.takeaway === "no" || tags.amenity === "bar" || tags.amenity === "pub") return false;
  if (NOT_PORTABLE_NAME.test(place.name)) return false;
  return PORTABLE_CUISINES.includes(place.cuisine) || place.chips.some((c) => PORTABLE_CHIPS.includes(c));
}

function cleanWebsite(url) {
  if (!url) return null;
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return URL.canParse(full) ? full : null;
}

async function fetchCityPlaces() {
  const url = new URL("https://data.cityofnewyork.us/resource/43nn-pn8j.json");
  url.searchParams.set(
    "$select",
    "camis,dba,cuisine_description,building,street,phone,latitude,longitude,grade,inspection_date,action"
  );
  url.searchParams.set("$where", `within_circle(location,${BAR.lat},${BAR.lng},${RADIUS_M})`);
  url.searchParams.set("$order", "inspection_date DESC");
  url.searchParams.set("$limit", "50000");
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`NYC open data → HTTP ${res.status}`);
  const rows = await res.json();

  // One row per violation per inspection. Newest first, so the first row for a
  // place is its latest inspection; the latest grade may sit on an older one.
  const latest = new Map();
  const grades = new Map();
  for (const r of rows) {
    if (!latest.has(r.camis)) latest.set(r.camis, r);
    if (r.grade && "ABC".includes(r.grade) && !grades.has(r.camis)) grades.set(r.camis, r.grade);
  }

  const oldest = Date.now() - MAX_INSPECTION_AGE_MS;
  const byName = new Map(); // nearest branch wins, so a reroll can't repeat a chain
  for (const r of latest.values()) {
    const cuisine = r.cuisine_description;
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    if (!cuisine || SKIP_CUISINES.has(cuisine) || !lat || !lng) continue; // not yet inspected
    if (SKIP_NAMES.test(r.dba) || new Date(r.inspection_date).getTime() < oldest) continue;
    if (/closed by dohmh/i.test(r.action || "")) continue;

    const walkMin = walkMinutes(haversine(BAR, { lat, lng }));
    if (walkMin > WALK_MAX) continue;
    const name = titleCase(r.dba);
    const known = byName.get(name.toLowerCase());
    if (known && known.walkMin <= walkMin) continue;

    const chips = chipsFor(name, cuisine);
    const place = {
      name,
      cuisine,
      chips,
      moods: MOODS.filter((m) => m.chips.some((c) => chips.includes(c))).map((m) => m.id),
      snack: SNACK_KINDS.includes(cuisine),
      daytime: DAYTIME_CUISINES.includes(cuisine) || DAYTIME_NAME.test(name),
      portable: false,
      walkMin,
      lat: +lat.toFixed(5),
      lng: +lng.toFixed(5),
      address: titleCase(`${r.building} ${r.street}`),
      phone: /^\d{10}$/.test(r.phone || "") ? r.phone : null,
      grade: grades.get(r.camis) || null,
      hours: null,
      delivers: false,
      website: null,
    };
    place.portable = isPortable(place);
    byName.set(name.toLowerCase(), place);
  }
  return [...byName.values()];
}

// Food places with useful tags, tile by tile: the main API caps the size of a
// single request. One at a time with a pause, because it's a shared service.
async function fetchOsmPlaces() {
  const dLat = RADIUS_M / 111320;
  const dLng = dLat / Math.cos((BAR.lat * Math.PI) / 180);
  const TILES = 4;
  const found = [];
  for (let y = 0; y < TILES; y++) {
    for (let x = 0; x < TILES; x++) {
      const west = BAR.lng - dLng + (2 * dLng * x) / TILES;
      const south = BAR.lat - dLat + (2 * dLat * y) / TILES;
      const bbox = [west, south, west + (2 * dLng) / TILES, south + (2 * dLat) / TILES]
        .map((n) => n.toFixed(5))
        .join(",");
      const res = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`, {
        headers: { "user-agent": UA },
      });
      if (!res.ok) throw new Error(`OSM tile ${x},${y} → HTTP ${res.status}`);
      const { elements } = await res.json();
      const nodes = new Map(
        elements.filter((e) => e.type === "node").map((e) => [e.id, e])
      );
      for (const e of elements) {
        const t = e.tags || {};
        if (!t.name || !/^(restaurant|fast_food|cafe|ice_cream|bar|pub)$/.test(t.amenity || "")) continue;
        const useful = t.opening_hours || t.delivery === "yes" || t.takeaway || t.website || t["contact:website"];
        if (!useful && t.amenity !== "fast_food") continue;
        // A building outline has no point of its own; any corner is close enough.
        const at = e.type === "way" ? e.nodes.map((id) => nodes.get(id)).find(Boolean) : e;
        if (at?.lat != null) found.push({ name: t.name, lat: at.lat, lng: at.lon, tags: t });
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return found;
}

const squash = (s) =>
  s.toLowerCase().replace(/\b(the|restaurant|cafe|bar|nyc)\b/g, "").replace(/[^a-z0-9]/g, "");

function sameName(a, b) {
  const x = squash(a);
  const y = squash(b);
  if (x === y) return x.length > 0;
  return Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x));
}

function addOsmDetails(places, osm) {
  let matched = 0;
  for (const p of places) {
    const hit = osm.find((o) => sameName(p.name, o.name) && haversine(p, o) < 150);
    if (!hit) continue;
    p.hours = hit.tags.opening_hours || null;
    p.delivers = hit.tags.delivery === "yes";
    p.website = cleanWebsite(hit.tags.website || hit.tags["contact:website"]);
    p.portable = isPortable(p, hit.tags);
    matched++;
  }
  return matched;
}

const previous = JSON.parse(readFileSync(OUT, "utf8")).places;
const places = await fetchCityPlaces();
if (places.length < previous.length * MIN_SHARE_OF_PREVIOUS) {
  throw new Error(`Only ${places.length} places came back (had ${previous.length}); keeping the existing list.`);
}
console.log(`NYC open data: ${places.length} places`);

try {
  const osm = await fetchOsmPlaces();
  console.log(`OpenStreetMap: ${osm.length} tagged, matched ${addOsmDetails(places, osm)}`);
} catch (err) {
  console.warn(`OpenStreetMap failed, keeping last known hours: ${err.message}`);
  const known = new Map(previous.map((p) => [p.name, p]));
  for (const p of places) {
    const last = known.get(p.name);
    if (last) Object.assign(p, { hours: last.hours, delivers: last.delivers, website: last.website, portable: last.portable });
  }
}

places.sort((a, b) => a.walkMin - b.walkMin || a.name.localeCompare(b.name));

// One place per line, so a refresh diff shows exactly what opened and closed.
const updated = new Date().toISOString().slice(0, 10);
const lines = places.map((p) => "  " + JSON.stringify(p)).join(",\n");
writeFileSync(OUT, `{"updated":"${updated}","places":[\n${lines}\n]}\n`);

const counts = CUISINES.map((c) => `${c.id}:${places.filter((p) => p.chips.includes(c.id)).length}`);
console.log(`Wrote ${places.length} places. Chips: ${counts.join(" ")}`);
const moodCounts = MOODS.map((m) => `${m.id}:${places.filter((p) => p.moods.includes(m.id) && p.portable).length}`);
console.log(`Moods, bring-back only: ${moodCounts.join(" ")}`);
console.log(
  `Hours: ${places.filter((p) => p.hours).length}, websites: ${places.filter((p) => p.website).length}, ` +
    `bring-back: ${places.filter((p) => p.portable && !p.snack).length}, daytime: ${places.filter((p) => p.daytime).length}`
);
