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
  -- events.id of the tool call whose measured interval contained this event.
  -- Nullable and no FK on purpose: retention may delete the parent, and a
  -- dangling pointer must degrade to "renders flat", never to a constraint error.
  during_tool_event_id INTEGER,
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

CREATE TABLE IF NOT EXISTS token_usage (
  id              INTEGER PRIMARY KEY,
  folder_id       TEXT NOT NULL,
  ts              INTEGER NOT NULL,
  session_id      TEXT,
  topic           TEXT,
  message_id      TEXT UNIQUE,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  thinking_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read      INTEGER NOT NULL DEFAULT 0,
  cache_creation  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS usage_folder_topic ON token_usage (folder_id, topic);
