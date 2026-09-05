# Food tab — design

A fourth tab ("**Food**") that helps Holden / Stern / Biener decide what to eat
while sitting at The Dead Poet (450 Amsterdam Ave #2, New York, NY 10024). You
feed it a few constraints, it pulls real nearby restaurants, an AI ranks them,
and you get a **top-3 shortlist** with a one-line reason and links to walk there
or order in.

**Hard constraint: zero cost, no credit card on file anywhere, no billing risk.**
Usage is ~once a month. Every piece below is either free with no card, or rides
on a Cloudflare Free-plan allocation that *rate-limits instead of billing* when
exhausted.

Stateless — no history, no D1 writes at all.

---

## 1. What the user does

1. Opens the **Food** tab.
2. Sets four inputs:
   - **Hunger** — segmented: `Snack` / `Real meal` / `Feast`
   - **Craving** — multi-select cuisine chips *plus* a free-text box
     ("…or say what you're feeling")
   - **Budget** — multi-select tiers: `$` / `$$` / `$$$` (empty = any; soft
     AI-only signal — see §3)
   - **Walk** — slider, 5–25 min ("Walk up to 12 min"). Applies to walk-to
     picks; delivery picks ignore it.
3. Taps **Find food**.
4. Gets 3 ranked cards. Each card:
   - name
   - meta line: cuisine · `7 min walk` and/or `delivers`
   - one plain, practical sentence of reasoning
   - **Directions ↗** (Google Maps link) and **Order ↗** (Google search
     `"<name> delivery order"`)
5. **Reroll** button re-runs the same inputs, excluding the 3 it just showed.

Results are **blended**: walk-to and delivery options share one list, each pick
labeled with its mode(s). A place can show both.

---

## 2. Data source — OpenStreetMap via Overpass

The only mapping data that is genuinely free with **no key and no card** is
OpenStreetMap. We query the public **Overpass API**
(`https://overpass-api.de/api/interpreter`, fallback mirror
`https://overpass.kumi.systems/api/interpreter`).

Manhattan / Upper West Side OSM coverage is dense. Trade-off vs Google/Yelp:
**no ratings, no price level, and `opening_hours` is present only sometimes**
and in OSM's own syntax.

**Bar location** is hardcoded: `lat 40.7864, lng -73.9764` (≈ 450 Amsterdam Ave).

### Query

```
[out:json][timeout:20];
nwr["amenity"~"^(restaurant|fast_food|cafe)$"](around:RADIUS,40.7864,-73.9764);
out center tags 40;
```
`RADIUS` = `clamp(maxWalkMin * 80, 1000, 2200)` metres.

Tags used: `name`, `cuisine`, `amenity`, `opening_hours`, `takeaway`,
`delivery`, `website`, `phone` / `contact:phone`, `addr:*`.

### Filtering pipeline (in the Worker)

1. Fetch Overpass (5xx / timeout → retry once on the mirror → `503` to client).
2. Drop entries with no `name`.
3. **Open now:** if `opening_hours` is present, best-effort parse (tiny
   evaluator for the common `Mo-Su 11:00-23:00` /
   `Mo-Fr 11:00-15:00,17:00-22:00` forms). Parses to closed → drop. Absent or
   unparseable → keep, mark hours `unknown`.
4. **Cuisine chips:** keep places whose `cuisine` tag matches any selected chip
   via the map in §4. OSM `cuisine` is `;`-separated (e.g. `pizza;italian`).
   No chips → keep all. Free-text craving is **not** a hard filter — it goes to
   the AI.
5. **Hunger / Budget are not hard filters** (OSM has no price). They're context
   for the AI: `amenity=fast_food`/`cafe` skews cheap + snack-friendly;
   `amenity=restaurant` skews meal/feast + pricier. Budget nudges ordering only.
6. Walk time per place: `haversine(bar, place) * 1.3 / 80 m·min⁻¹`, rounded.
   No routing API.
7. Keep ~15 nearest survivors → hand a compact list to the AI.

### Modes per place

- **walk** — available if `walkMin ≤ maxWalkMin`.
- **delivers** — shown when `delivery=yes`. Absent/`no` → no delivery tag, but
  the **Order ↗** link is still offered as a generic search so a missing tag
  isn't a dead end.

---

## 3. AI step

Reuses the existing Workers AI binding and model
(`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) — the same one the Games tab uses.
On the Cloudflare **Free** plan, Workers AI past the daily allocation returns an
error; it does **not** bill. Stays inside the zero-cost rule.

**Input to model:** the user's constraints + free-text craving, and a compact
candidate list — one line each:
`name | cuisine | amenity | walkMin | delivers(y/n) | hours(open/unknown)`.

**Prompt shape:**
> You help three friends at a bar pick dinner. Choose exactly 3 from the
> candidate list and rank them best-first for: hunger=`<>`, budget=`<>`,
> cuisines=`<>`, craving="`<>`", max walk `<>` min. Return JSON:
> `[{ "name": "...", "reason": "..." }]`. Reason ≤ 140 chars, plain and
> practical, name the deciding factor (distance, what travels well, fits the
> craving, portion size for the hunger level). Pick only from the list. Never
> invent a place.

`temperature: 0.3`, `max_tokens: 500`. Parse JSON; on parse failure or AI error,
**fall back** to top-3 by `(cuisine match, then walkMin)` with a templated reason
(`"6 min walk, matches Thai"`). Reroll passes an `exclude` array of names.

---

## 4. Cuisine chips → OSM `cuisine` values

Shown as toggle chips in `food.js`. Each chip maps to one or more OSM
`cuisine` tag values (matched case-insensitively against the `;`-split tag).
~24 chips, roughly ordered common → niche:

| Chip | OSM `cuisine` values matched |
|---|---|
| Pizza | `pizza` |
| Burgers | `burger` |
| Sandwiches / Deli | `sandwich`, `deli` |
| Bagels | `bagel` |
| Tacos / Mexican | `mexican`, `taco`, `tex-mex`, `burrito` |
| Chinese | `chinese`, `cantonese`, `szechuan` |
| Thai | `thai` |
| Sushi / Japanese | `sushi`, `japanese` |
| Ramen / Noodles | `ramen`, `noodle`, `udon` |
| Korean | `korean` |
| Vietnamese | `vietnamese` |
| Indian | `indian`, `pakistani` |
| Italian / Pasta | `italian`, `pasta` |
| American / Diner | `american`, `diner`, `breakfast` |
| Wings / Fried chicken | `chicken`, `wings`, `fried_chicken` |
| BBQ | `barbecue` |
| Steakhouse | `steak_house` |
| Seafood | `seafood` |
| Mediterranean / Greek | `mediterranean`, `greek` |
| Middle Eastern / Falafel | `middle_eastern`, `falafel`, `lebanese`, `turkish` |
| Halal cart | `kebab`, `halal` (+ `amenity=fast_food` name contains "halal") |
| French | `french` |
| Salad / Healthy | `salad`, `vegetarian`, `vegan`, `poke`, `bowl` |
| Dessert / Ice cream | `ice_cream`, `dessert`, `cake`, `donut` |

Anything whose `cuisine` doesn't match a selected chip is filtered out only when
at least one chip is selected. A place with **no** `cuisine` tag is kept when no
chips are selected, and dropped when chips are selected (it can't be matched).

---

## 5. Endpoint

### `POST /api/food`
Body:
```json
{
  "hunger": "snack | meal | feast",
  "cuisines": ["pizza", "thai"],
  "craving": "something spicy",
  "budget": ["low", "mid", "high"],   // 0-3 tiers ($ / $$ / $$$), empty = any
  "maxWalkMin": 12,
  "exclude": ["Name A", "Name B"]     // optional, for reroll
}
```
Response:
```json
{
  "picks": [
    {
      "name": "…",
      "cuisine": "Thai",
      "walkMin": 7,
      "modes": ["walk", "delivery"],
      "hours": "open | unknown",
      "reason": "Closest spicy option and curries travel well in a bag.",
      "mapsUrl": "https://www.google.com/maps/search/?api=1&query=…",
      "orderUrl": "https://www.google.com/search?q=…+delivery+order",
      "phone": "+1…"
    }
  ]
}
```
`mapsUrl` / `orderUrl` are built from the name + coords, no API. Errors: `503`
if Overpass is unreachable on both endpoints, `400` on bad input.

No config endpoint — the chip list is static in `food.js`.

---

## 6. Keeping it free & light

- **No keys, no secrets, no billing account.** Overpass is open; Workers AI /
  Workers / static assets are all on the existing Cloudflare Free plan.
- **No D1 use, no daily cap** — nothing costs money, so nothing to meter.
- **Courtesy cache:** `caches.default`, 600 s TTL on the Overpass fetch, keyed by
  rounded radius. Polite to a shared free endpoint and makes Reroll instant —
  Reroll reuses the cached candidate set and just re-asks the AI.
- One "Find food" = 1 Overpass call (often cached) + 1 Workers AI call.

---

## 7. Files to add / change

| File | Change |
|---|---|
| `public/food.html` | New page. Same header/nav/footer as `games.html`; `<main id="food">` with the decide-card + results container. |
| `public/food.js` | Inputs → `POST /api/food` → render 3 `.pick-card`s; Reroll. Chip list + chip→cuisine map live here. |
| `public/styles.css` | Add `.seg` (segmented control), `.chip` / `.chip[aria-pressed]`, `.pick-card`, `.mode-tag`, range-input styling. Reuse `.ask-card`, `.field`, `.ask-btn`, `.game-card`. |
| `public/index.html`, `public/games.html`, `public/history.html` | Add 4th `<a class="tab" href="/food">Food</a>` to the nav. |
| `src/worker.js` | `POST /api/food` handler: validate → Overpass (cache + mirror fallback) → filter → walk-time → AI rank → merge → respond. Helpers: `overpassRestaurants`, `parseOpeningHours`, `rankWithAI`, `haversine`. |
| `src/food.js` (new) | Static config: bar lat/lng, chip→OSM-cuisine map, hunger/budget hint text, maps/order URL builders. Mirrors `src/games.js`. |
| `wrangler.toml` | No changes (AI already bound). |
| `devserver.py` | Route `/food` → `food.html`; handle `/api/food`. No secrets to wire. |
| `README.md` | One line: Food tab, OSM/Overpass, no keys. |

---

## 8. Resolved decisions

1. **Order link** — plain Google search (`"<name> delivery order"`). ✅
2. **`opening_hours`** — small best-effort parser + `unknown` fallback. ✅
3. **Cuisine chips** — the ~24-chip set in §4. ✅
4. **Tab label** — "Food" (route `/food`, files `food.*`). ✅
5. **Budget input** — multi-select `$` / `$$` / `$$$` tiers, kept as a soft
   AI-only signal, no data filter. ✅

---

## 9. Explicit non-goals for v1

- No ratings or price levels (OSM has none).
- No saved history / "what did we eat last time" / repeat down-weighting.
- No in-app ordering or payment — links out only.
- No "how drunk" input.
- No account/personalization per person.
- No in-app map — links to Google Maps.
- No paid APIs, no API keys, no billing account — ever.
