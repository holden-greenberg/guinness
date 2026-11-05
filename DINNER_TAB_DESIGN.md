# Food tab — design

A fourth tab ("**Food**") for when Holden / Stern / Biener are at The Dead Poet
(450 Amsterdam Ave #2, New York, NY 10024) and nobody knows what they want. The
bar allows outside food and they usually eat around 7-8pm, so it's built around
one question: what should someone go and bring back?

**Hard constraint: zero cost, no credit card on file anywhere, no billing risk.**
Every piece below is either free with no card, or rides on a Cloudflare Free-plan
allocation that *rate-limits instead of billing* when exhausted.

Stateless — no history, no D1 writes at all.

---

## 1. What the user does

1. Opens the **Food** tab. Three different options are already there, with no form
   to fill in first.
2. Optionally taps a mood (`Greasy` / `Fresh` / `Spicy` / `Comfort`) to reshuffle.
3. Taps **Nah** on any card to swap just that place, or **Three more** for a new set.
4. Taps **Menu** or **Call to order**. Smaller links: Delivery options, Photos &
   reviews (the Google Maps page), Directions.

**More options** (collapsed): Bring it back / Eat out, walk distance, cuisine chips,
and a text box that searches names and cuisines.

Each card shows the name, cuisine, `3 min each way`, health grade, address and
either `Open until 10 PM` or `Hours not on file`.

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

### Build-time flags on each place

- `chips` / `moods` — which cuisine chips and mood buttons it fits.
- `portable` — easy to bring back. A best guess from cuisine and name, overridden
  by OpenStreetMap's takeout and bar tags. The data doesn't say who does takeout,
  so a sit-down place sometimes slips through. That's what **Nah** is for.
- `snack` — coffee, juice, dessert.
- `daytime` — bagels, breakfast and the like, likely shut by dinner.

### Picking (in the Worker)

1. Drop places beyond the walk limit, or outside the chosen mood, chips or search.
2. Unless a chip or search asked for them: drop snacks, drop non-`portable` places
   when bringing food back, and from 3pm drop `daytime` places with no hours on file.
3. Evaluate `opening_hours`. Closed → drop. Absent or unparseable → keep, labelled
   `Hours not on file`.
4. Order by walk time plus some randomness, so close places usually come first but
   each visit differs. Return up to 30.

The page keeps those 30 and deals from them, preferring cuisines not already on
screen. Nah and Three more need no further request, and a new request only happens
when the filters change or the 30 run out.

Walk time is computed at build time: `haversine(bar, place) * 1.3 / 80 m·min⁻¹`.

---

## 3. No AI

v1 had Workers AI rank the picks and write a reason for each. It took 2-5 seconds,
and with only cuisine, distance and hours to go on, its reasons just repeated the
card. Removed so picks are instant and there's one less thing to fail. The Games
tab still uses Workers AI.

---

## 4. Cuisine chips

Defined in `CUISINES` in `src/food.js`. At build time a place gets a chip if its
city cuisine is in the chip's `match` list or its name fits the chip's `name`
pattern. Labels are repeated in `public/food.js`.

---

## 5. Endpoint

### `POST /api/food`
Body (all optional):
```json
{
  "mood": "greasy | fresh | spicy | comfort",
  "cuisines": ["pizza", "thai"],
  "query": "dumplings",
  "maxWalkMin": 8,
  "eatOut": false
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
      "walkMin": 3,
      "eatOut": false,
      "hours": "Open until 10 PM",
      "delivers": false,
      "phone": "2125551234",
      "menuUrl": "https://…",
      "orderUrl": "https://www.google.com/search?q=…",
      "directionsUrl": "https://www.google.com/maps/dir/?api=1&…",
      "reviewsUrl": "https://www.google.com/maps/search/?api=1&query=…"
    }
  ]
}
```
`menuUrl` is the place's website where known, otherwise a Google search. Links are
built from the name and address, no API.

---

## 6. Keeping it free & light

- **No keys, no secrets, no billing account.** The list ships with the Worker, and
  Workers and static assets are on the existing Cloudflare Free plan.
- **No D1 use, no AI, no outside calls** when picking food.

---

## 7. Non-goals

- No ratings, prices or photos on the card (the data has none). Photos & reviews links out instead.
- No saved history or ratings yet. Group thumbs up/down is the likely next step.
- No in-app ordering or payment — links out only.
- No "how drunk" input.
- No account/personalization per person.
- No in-app map — links to Google Maps.
- No paid APIs, no API keys, no billing account — ever.
