-- Accounts for openanstruk.org and 3d.openanstruk.org (D1 database "openanstruk-users").
--   npx wrangler d1 execute openanstruk-users --remote --file schema.sql
-- Safe to run again: every statement is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  google_sub      TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  picture         TEXT NOT NULL DEFAULT '',
  birth_year      INTEGER,
  occupation      TEXT,
  institution     TEXT,
  consent_version TEXT,           -- the privacy-policy version the user agreed to
  consent_at      TEXT,
  created_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL
);

-- One row per app visit (at most one per user and app every 12 hours), so the age
-- at the time of use is the visit's year minus birth_year.
CREATE TABLE IF NOT EXISTS visits (
  id      INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app     TEXT NOT NULL CHECK (app IN ('2d', '3d')),
  at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS visits_user ON visits(user_id);
