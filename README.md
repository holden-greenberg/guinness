# The Dead Poet — Guinness Challenge

A phone-friendly web app for **Matt Stern**, **Alex Biener**, and **Holden Greenberg**
to track lifetime Guinnesses at The Dead Poet (100 = your name on the wall) and to
count the current session while at the bar.

- Open the link — no login, no code.
- Tap **+1 Guinness** on your card. It adds one to your lifetime total *and* to
  the shared "tonight" counter, on every phone.
- **Undo** removes your most recent tap (mis-taps happen).
- **Reset tonight** starts a fresh session. Lifetime totals are never touched.

## Stack

| Piece | What |
|---|---|
| Frontend | Plain HTML/CSS/JS in [`public/`](public/) — no build step |
| API | Cloudflare Pages Functions in [`functions/api/`](functions/api/) |
| Data | Cloudflare D1 (SQLite) — schema in [`schema.sql`](schema.sql) |

API routes: `GET /api/state`, `POST /api/drink`, `POST /api/undo`, `POST /api/reset-tonight`.

## One-time deploy

Needs [Node.js](https://nodejs.org) installed (for the Wrangler CLI) and a free
Cloudflare account.

```bash
npm install
npx wrangler login

# Create the database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create guinness

# Load the tables + the three drinkers
npm run db:init:remote
```

Push this repo to GitHub, then in the Cloudflare dashboard:

1. **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
2. Build settings: **Framework preset: none**, **Build command: empty**,
   **Build output directory: `public`**.
3. After the first deploy: **Settings → Bindings → Add → D1 database** →
   variable name **`DB`**, database **guinness**. Redeploy.
4. Share the `*.pages.dev` URL with the group. Add it to the Home Screen for an
   app-like icon.

Every `git push` to the default branch redeploys automatically.

## Setting the historical counts

`schema.sql` seeds everyone at `lifetime_start = 0`. Replace with the real
numbers once the history is tallied:

```bash
npx wrangler d1 execute guinness --remote \
  --command "UPDATE people SET lifetime_start = 42 WHERE id = 'matt'"
```

(`lifetime` shown in the app = `lifetime_start` + taps logged in the app.)

## Local development

```bash
npm run db:init:local   # seed the local SQLite copy
npm run dev             # serves at http://localhost:8788
```
