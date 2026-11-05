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

## 2. Data source — a built-in list

The bar doesn't move, so the restaurant list is built ahead of time and shipped
with the Worker as `src/restaurants.json`. **Nothing external is called to find
restaurants**, so no outage can break the tab. (v1 queried public Overpass
servers on every search; they were down too often to rely on.)

`scripts/refresh-restaurants.mjs` rebuilds the list from two free, keyless
sources. A GitHub Actions workflow runs it on the 1st of each month and commits
the result, and the push to `main` redeploys the Worker. It runs outside the
Worker because the free plan's CPU limit is far too small to parse these downloads.
If the city data looks wrong the run fails and the old list stays.

- **NYC health inspection open data** (`data.cityofnewyork.us`, dataset
  `43nn-pn8j`): who exists, cuisine, address, phone, letter grade. Skips places
  never inspected or last inspected over 2 years ago, those closed by the health
  department at their latest inspection, and non-dinner venues (hotels, theatres,
  museums, dining halls).
- **OpenStreetMap main API**: `opening_hours` and `delivery`, matched to a city
  record by name within 150 m. If this fails, the last known hours are kept.

Trade-off: no ratings or prices, hours for only about half the list, and new
places can take up to a month to appear.

### Filtering pipeline (in the Worker)

1. Drop places beyond the walk limit, unless they deliver.
2. **Cuisine chips:** keep places carrying a selected chip. With no chips, drop
   snack-only kinds (coffee, juice, dessert) unless hunger is `Snack`.
3. **Open now:** evaluate `opening_hours`. Closed → drop. Absent or unparseable →
   keep, mark hours `unknown`.
4. Shuffle what's left, moving places whose name or cuisine contains a word from
   the craving box to the front, so they reach the AI.
5. Hand the first 15 to the AI, nearest first. Hunger and budget are context for
   the AI only.

Walk time is computed at build time: `haversine(bar, place) * 1.3 / 80 m·min⁻¹`.

### Modes per place

- **walk** — available if `walkMin ≤ maxWalkMin`.
- **delivers** — shown when OSM says `delivery=yes`. The **Order ↗** link is
  offered regardless, as a generic search.

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

## 4. Cuisine chips

Defined in `CUISINES` in `src/food.js`. At build time a place gets a chip if its
city cuisine is in the chip's `match` list or its name fits the chip's `name`
pattern. Labels are repeated in `public/food.js`.

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
      "address": "488 Amsterdam Avenue",
      "grade": "A",
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
`mapsUrl` / `orderUrl` are built from the name + address, no API. If the AI is
unavailable, picks fall back to nearest-first with a templated reason.

No config endpoint — the chip list is static in `food.js`.

---

## 6. Keeping it free & light

- **No keys, no secrets, no billing account.** The list ships with the Worker;
  Workers AI / Workers / static assets are all on the existing Cloudflare Free
  plan.
- **No D1 use, no daily cap** — nothing costs money, so nothing to meter.
- One "Find food" = 1 Workers AI call.

---

## 7. Resolved decisions

1. **Order link** — plain Google search (`"<name> delivery order"`). ✅
2. **`opening_hours`** — small best-effort parser + `unknown` fallback. ✅
3. **Cuisine chips** — the set in §4. ✅
4. **Tab label** — "Food" (route `/food`, files `food.*`). ✅
5. **Budget input** — multi-select `$` / `$$` / `$$$` tiers, kept as a soft
   AI-only signal, no data filter. ✅

---

## 8. Explicit non-goals for v1

- No ratings or price levels (the data has none).
- No saved history / "what did we eat last time" / repeat down-weighting.
- No in-app ordering or payment — links out only.
- No "how drunk" input.
- No account/personalization per person.
- No in-app map — links to Google Maps.
- No paid APIs, no API keys, no billing account — ever.
