# The Dead Poet — Guinness Challenge

A phone-friendly web app for **Matt Stern**, **Alex Biener**, and **Holden Greenberg**
to track lifetime Guinnesses at The Dead Poet (100 = your name on the wall) and to
count the current session while at the bar.

- Open the link — no login, no code.
- Tap **+1 Guinness** on your card. It adds one to your lifetime total *and* to
  the shared "tonight" counter, on every phone.
- **Undo** removes your most recent tap (mis-taps happen).
- **Reset tonight** starts a fresh session. Lifetime totals are never touched.

**Live:** https://guinness.holdengreenberg.workers.dev

## Stack

| Piece | What |
|---|---|
| Frontend | Plain HTML/CSS/JS in [`public/`](public/) — no build step |
| API | One Cloudflare Worker, [`src/worker.js`](src/worker.js) |
| Data | Cloudflare D1 (SQLite) — schema in [`schema.sql`](schema.sql) |

Static files in `public/` are served directly by the Worker's `[assets]`
binding; requests that don't match a file fall through to the Worker, which
handles `GET /api/state`, `POST /api/drink`, `POST /api/undo`,
`POST /api/reset-tonight`. The D1 binding (`DB`) is declared in
[`wrangler.toml`](wrangler.toml), so it's applied on every deploy — no
dashboard step.

## Deploy

```bash
npm install
npx wrangler deploy        # or: npm run deploy
```

The repo is also connected to Cloudflare (Workers Builds), so **every `git push`
to `main` redeploys automatically** — the build runs `npx wrangler deploy`.

First-time-only database setup (already done for the live instance):

```bash
npx wrangler login
npx wrangler d1 create guinness          # paste the id into wrangler.toml
npm run db:init:remote                   # create tables + seed the 3 drinkers
```

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
npm run dev             # wrangler dev, with a local D1
```

`devserver.py` is a separate, dependency-free preview server (Python stdlib
only) for machines without Node — it serves `public/` and reimplements the
same four routes against `.dev.sqlite`.
