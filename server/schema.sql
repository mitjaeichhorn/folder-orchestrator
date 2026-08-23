CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  path       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  ignore     TEXT NOT NULL DEFAULT '[]',
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  folder_id  TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  path       TEXT,
  actor      TEXT NOT NULL DEFAULT 'unknown',
  session_id TEXT,
  tool       TEXT,
  topic      TEXT,
  detail     TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS events_folder_ts ON events (folder_id, ts DESC);

CREATE TABLE IF NOT EXISTS rules (
  id                TEXT PRIMARY KEY,
  folder_id         TEXT,
  kinds             TEXT NOT NULL DEFAULT '[]',
  path_glob         TEXT NOT NULL DEFAULT '**',
  threshold_count   INTEGER,
  threshold_seconds INTEGER,
  actions           TEXT NOT NULL DEFAULT '["toast"]',
  label             TEXT NOT NULL DEFAULT '',
  enabled           INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL
);
