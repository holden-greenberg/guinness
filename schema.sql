-- The Dead Poet Guinness Challenge — full database schema for Cloudflare D1.
-- Apply to a FRESH database with:
--   wrangler d1 execute guinness --remote --file=./schema.sql
-- Re-running this DROPS everything and starts clean. For an existing database,
-- use the one-off migrate_*.sql files instead.

DROP TABLE IF EXISTS drinks;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS people;
DROP TABLE IF EXISTS meta;

CREATE TABLE people (
  id             TEXT PRIMARY KEY,           -- 'matt' | 'alex' | 'holden'
  name           TEXT NOT NULL,
  lifetime_start INTEGER NOT NULL DEFAULT 0, -- manual adjustment; normally 0
  sort           INTEGER NOT NULL DEFAULT 0
);

-- One row per night at the bar. matt/alex/holden = Guinnesses that person had.
CREATE TABLE sessions (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  date   TEXT NOT NULL,                 -- 'YYYY-MM-DD'
  matt   INTEGER NOT NULL DEFAULT 0,
  alex   INTEGER NOT NULL DEFAULT 0,
  holden INTEGER NOT NULL DEFAULT 0,
  note   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_sessions_date ON sessions(date);

-- One row per Guinness tapped live in the app during the current night, before
-- it's rolled into a sessions row via "Save tonight to history".
CREATE TABLE drinks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  TEXT NOT NULL REFERENCES people(id),
  created_at TEXT NOT NULL              -- ISO 8601 UTC
);
CREATE INDEX idx_drinks_person ON drinks(person_id, created_at);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- lifetime shown in the app = lifetime_start + SUM(sessions for that person)
--                            + count(drinks logged live but not yet rolled up)
INSERT INTO people (id, name, lifetime_start, sort) VALUES
  ('matt',   'Matt Stern',       0, 1),
  ('alex',   'Alex Biener',      0, 2),
  ('holden', 'Holden Greenberg', 0, 3);

-- "Tonight" = every live drink logged at or after this timestamp.
INSERT INTO meta (key, value) VALUES ('tonight_since', '1970-01-01T00:00:00.000Z');

-- Historical sessions, tallied 1/1/25 through 7/24/26.
-- (matt, alex, holden) — Biener = alex.
INSERT INTO sessions (date, matt, alex, holden, note) VALUES
  ('2025-01-01', 5, 9, 7, ''),
  ('2025-01-04', 6, 7, 6, 'Holden count estimated (not recorded that night)'),
  ('2025-02-07', 0, 7, 6, 'Stern not present'),
  ('2025-03-21', 6, 8, 7, ''),
  ('2025-05-24', 7, 4, 7, ''),
  ('2025-08-14', 5, 7, 5, ''),
  ('2025-09-26', 5, 7, 6, ''),
  ('2025-11-06', 5, 6, 4, ''),
  ('2025-12-19', 5, 8, 6, ''),
  ('2026-01-10', 7, 7, 7, ''),
  ('2026-03-27', 6, 6, 6, ''),
  ('2026-04-10', 5, 5, 5, ''),
  ('2026-05-08', 7, 7, 7, ''),
  ('2026-06-12', 5, 4, 4, ''),
  ('2026-07-24', 5, 4, 5, '');
