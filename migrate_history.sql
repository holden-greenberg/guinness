-- One-off migration: move the baked-in lifetime_start numbers into a real,
-- editable sessions history. Safe to run once on the live database.
--   wrangler d1 execute guinness --remote --file=./migrate_history.sql
-- Non-destructive to `drinks` and `meta`.

CREATE TABLE IF NOT EXISTS sessions (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  date   TEXT NOT NULL,
  matt   INTEGER NOT NULL DEFAULT 0,
  alex   INTEGER NOT NULL DEFAULT 0,
  holden INTEGER NOT NULL DEFAULT 0,
  note   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);

DELETE FROM sessions;
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

-- History now carries the totals; clear the manual baseline.
UPDATE people SET lifetime_start = 0;
