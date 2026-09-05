-- The Dead Poet Guinness Challenge — database schema for Cloudflare D1
-- Apply with:  wrangler d1 execute guinness --remote --file=./schema.sql
-- Re-running this DROPS everything and starts clean.

DROP TABLE IF EXISTS drinks;
DROP TABLE IF EXISTS people;
DROP TABLE IF EXISTS meta;

CREATE TABLE people (
  id             TEXT PRIMARY KEY,          -- 'matt' | 'alex' | 'holden'
  name           TEXT NOT NULL,
  lifetime_start INTEGER NOT NULL DEFAULT 0, -- Guinnesses already logged at the bar before this app existed
  sort           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE drinks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  TEXT NOT NULL REFERENCES people(id),
  created_at TEXT NOT NULL                   -- ISO 8601 UTC, e.g. 2026-09-05T23:14:02.123Z
);
CREATE INDEX idx_drinks_person ON drinks(person_id, created_at);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- lifetime_start = Guinnesses logged at the bar before this app existed,
-- tallied from 15 sessions (1/1/25 through 7/24/26). The app adds taps on
-- top of these. To adjust one:
--   wrangler d1 execute guinness --remote --command "UPDATE people SET lifetime_start=80 WHERE id='matt'"
INSERT INTO people (id, name, lifetime_start, sort) VALUES
  ('matt',   'Matt Stern',       79, 1),
  ('alex',   'Alex Biener',      96, 2),
  ('holden', 'Holden Greenberg', 88, 3);

-- "Tonight" = every drink logged at or after this timestamp. The Reset button
-- moves it to "now". Starts in 1970 so the first night counts everything.
INSERT INTO meta (key, value) VALUES ('tonight_since', '1970-01-01T00:00:00.000Z');
