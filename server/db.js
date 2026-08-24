import { DatabaseSync } from 'node:sqlite'
import { readFileSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')

export function open (path) {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(SCHEMA)
  migrate(db)
  return db
}

// sqlite has no ADD COLUMN IF NOT EXISTS — check the table first.
function migrate (db) {
  const cols = db.prepare('PRAGMA table_info(events)').all().map(c => c.name)
  if (!cols.includes('topic')) db.exec('ALTER TABLE events ADD COLUMN topic TEXT')
  if (!cols.includes('during_tool_event_id')) {
    db.exec('ALTER TABLE events ADD COLUMN during_tool_event_id INTEGER')
  }
  const scols = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name)
  if (scols.length && !scols.includes('ai_title')) {
    db.exec('ALTER TABLE sessions ADD COLUMN ai_title TEXT')
  }
}

const rowToFolder = r => r && ({
  id: r.id, path: r.path, name: r.name,
  ignore: JSON.parse(r.ignore), enabled: !!r.enabled, createdAt: r.created_at
})

const rowToEvent = r => ({
  id: r.id, folderId: r.folder_id, ts: r.ts, kind: r.kind, path: r.path,
  actor: r.actor, sessionId: r.session_id, tool: r.tool, topic: r.topic,
  // rows written before this column existed read as null — old data stays well-formed
  duringToolEventId: r.during_tool_event_id ?? null,
  detail: JSON.parse(r.detail)
})

export function listFolders (db) {
  return db.prepare('SELECT * FROM folders ORDER BY created_at').all().map(rowToFolder)
}

export function getFolder (db, id) {
  return rowToFolder(db.prepare('SELECT * FROM folders WHERE id = ?').get(id))
}

export function addFolder (db, { path, name, ignore = [] }) {
  let st
  try { st = statSync(path) } catch { throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR_OR_MISSING' }) }
  if (!st.isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR_OR_MISSING' })
  if (db.prepare('SELECT 1 FROM folders WHERE path = ?').get(path)) {
    throw Object.assign(new Error('already watched'), { code: 'DUPLICATE' })
  }
  const f = { id: randomUUID(), path, name: name || basename(path), ignore, enabled: true, createdAt: Date.now() }
  db.prepare('INSERT INTO folders (id,path,name,ignore,enabled,created_at) VALUES (?,?,?,?,?,?)')
    .run(f.id, f.path, f.name, JSON.stringify(ignore), 1, f.createdAt)
  return f
}

export function patchFolder (db, id, fields) {
  const cur = getFolder(db, id)
  if (!cur) return null
  const next = {
    name: fields.name ?? cur.name,
    ignore: fields.ignore ?? cur.ignore,
    enabled: fields.enabled ?? cur.enabled
  }
  db.prepare('UPDATE folders SET name=?, ignore=?, enabled=? WHERE id=?')
    .run(next.name, JSON.stringify(next.ignore), next.enabled ? 1 : 0, id)
  return getFolder(db, id)
}

export function removeFolder (db, id, purge) {
  if (purge) db.prepare('DELETE FROM events WHERE folder_id = ?').run(id)
  db.prepare('DELETE FROM rules WHERE folder_id = ?').run(id)
  return db.prepare('DELETE FROM folders WHERE id = ?').run(id).changes > 0
}

export function insertEvent (db, e) {
  const r = db.prepare(
    `INSERT INTO events (folder_id,ts,kind,path,actor,session_id,tool,topic,during_tool_event_id,detail)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(e.folderId, e.ts, e.kind, e.path ?? null, e.actor ?? 'unknown',
        e.sessionId ?? null, e.tool ?? null, e.topic ?? null,
        e.duringToolEventId ?? null, JSON.stringify(e.detail ?? {}))
  return Number(r.lastInsertRowid)
}

export function listEvents (db, { folderId, limit = 200, before, kinds, sessionId } = {}) {
  const where = ['folder_id = ?']
  const args = [folderId]
  if (before) { where.push('id < ?'); args.push(before) }
  if (sessionId) { where.push('session_id = ?'); args.push(sessionId) }
  if (kinds?.length) { where.push(`kind IN (${kinds.map(() => '?').join(',')})`); args.push(...kinds) }
  args.push(Math.min(limit, 1000))
  return db.prepare(
    `SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`
  ).all(...args).map(rowToEvent)
}

/**
 * The exact-path join. Unconditional on purpose: attribution outranks containment,
 * so this upgrades `during-claude` to `claude` and is never refused.
 */
export function relabelEvent (db, id, { actor, sessionId, topic, duringToolEventId }) {
  db.prepare(`UPDATE events SET actor=?, session_id=?, topic=COALESCE(?, topic),
              during_tool_event_id=COALESCE(?, during_tool_event_id) WHERE id=?`)
    .run(actor, sessionId ?? null, topic ?? null, duringToolEventId ?? null, id)
}

/**
 * Containment, not causation — see invariant 6 of the event contract.
 *
 * `WHERE actor='external'` is the whole design. Only a row still at the null
 * hypothesis may be labelled, which makes this idempotent and order-independent
 * against the path join: the join can run before or after and still wins. It also
 * means the `actor: 'unknown'` rate-ceiling rows are never touched — a summary row
 * standing for N unidentified changes must not claim containment.
 *
 * Returns whether a row actually changed, which is the signal for whether to send
 * a patch frame. Never patch a row the database declined to touch.
 */
export function markDuring (db, id, { sessionId, topic, duringToolEventId } = {}) {
  return db.prepare(
    `UPDATE events SET actor='during-claude', session_id=COALESCE(session_id,?),
     topic=COALESCE(topic,?), during_tool_event_id=? WHERE id=? AND actor='external'`
  ).run(sessionId ?? null, topic ?? null, duringToolEventId ?? null, id).changes > 0
}

/** Merge fields into an event's detail. Used to close a running tool call. */
export function updateEventDetail (db, id, patch) {
  const row = db.prepare('SELECT detail FROM events WHERE id = ?').get(id)
  if (!row) return null
  const detail = { ...JSON.parse(row.detail), ...patch }
  db.prepare('UPDATE events SET detail = ? WHERE id = ?').run(JSON.stringify(detail), id)
  return detail
}

/**
 * Remember what a session is: its branch, its working directory, how it was
 * launched. Written only when something actually changes — a transcript line is
 * parsed per record, and an unconditional upsert would be a write per line.
 */
export function upsertSession (db, { id, folderId, gitBranch, cwd, entrypoint, version, aiTitle }, now = Date.now()) {
  if (!id || !folderId) return false
  return db.prepare(
    `INSERT INTO sessions (id, folder_id, git_branch, cwd, entrypoint, version, ai_title, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
       cwd        = COALESCE(excluded.cwd,        sessions.cwd),
       entrypoint = COALESCE(excluded.entrypoint, sessions.entrypoint),
       version    = COALESCE(excluded.version,    sessions.version),
       ai_title   = COALESCE(excluded.ai_title,   sessions.ai_title),
       updated_at = excluded.updated_at`
  ).run(id, folderId, gitBranch ?? null, cwd ?? null, entrypoint ?? null, version ?? null,
        aiTitle ?? null, now).changes > 0
}

export function sessions (db, folderId, limit = 20) {
  return db.prepare(
    `SELECT e.session_id AS id, MIN(e.ts) AS startedAt, MAX(e.ts) AS lastAt,
            COUNT(*) AS events, COUNT(DISTINCT e.path) AS files,
            s.git_branch AS gitBranch, s.cwd AS cwd,
            s.entrypoint AS entrypoint, s.version AS version, s.ai_title AS aiTitle
     FROM events e
     LEFT JOIN sessions s ON s.id = e.session_id
     WHERE e.folder_id = ? AND e.session_id IS NOT NULL
     GROUP BY e.session_id ORDER BY lastAt DESC LIMIT ?`
  ).all(folderId, limit)
}

export function sweepRetention (db, days = 30, now = Date.now()) {
  const cutoff = now - days * 86400000
  return db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff).changes
}

/**
 * A tool call is written as `running` and closed when its result is tailed. A
 * restart resumes tailing at EOF, so results written before it are never seen
 * and those rows would claim to be running forever — which also drags the
 * "work in progress" window back hours.
 *
 * We cannot know how they ended, so they become `unknown` rather than `done`.
 */
export function closeOrphanedRunning (db) {
  const rows = db.prepare("SELECT id, detail FROM events WHERE kind = 'tool'").all()
  const upd = db.prepare('UPDATE events SET detail = ? WHERE id = ?')
  let n = 0
  for (const r of rows) {
    let d
    try { d = JSON.parse(r.detail) } catch { continue }
    if (d.state !== 'running') continue
    upd.run(JSON.stringify({ ...d, state: 'unknown' }), r.id)
    n++
  }
  return n
}

// --- token usage ---------------------------------------------------------
/**
 * message_id is UNIQUE and the insert is OR IGNORE: re-reading a transcript
 * (rotation, restart, a second folder pointing at the same project) must never
 * double-count tokens.
 */
export function insertUsage (db, u) {
  // Returns true only for a NEW row, so the backfill log counts what it added
  // rather than what it revisited.
  const isNew = !u.messageId ||
    !db.prepare('SELECT 1 FROM token_usage WHERE message_id = ?').get(u.messageId)
  // ON CONFLICT updates ONLY the topic: token counts stay as first recorded, so
  // a re-read still cannot double-count, but a topic we learned to attribute
  // better (mid-turn messages) corrects itself on the next backfill.
  db.prepare(`INSERT INTO token_usage
      (folder_id,ts,session_id,topic,message_id,input_tokens,output_tokens,thinking_tokens,cache_read,cache_creation)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(message_id) DO UPDATE SET topic = excluded.topic`)
    .run(u.folderId, u.ts, u.sessionId ?? null, u.topic ?? null, u.messageId ?? null,
         u.inputTokens | 0, u.outputTokens | 0, u.thinkingTokens | 0, u.cacheRead | 0, u.cacheCreation | 0)
  return isNew
}

/** Tokens per task, biggest first. The topic IS the task. */
export function usageByTopic (db, folderId) {
  return db.prepare(`
    SELECT COALESCE(topic, '') AS topic,
           COUNT(*)                AS messages,
           SUM(input_tokens)       AS inputTokens,
           SUM(output_tokens)      AS outputTokens,
           SUM(thinking_tokens)    AS thinkingTokens,
           SUM(cache_read)         AS cacheRead,
           SUM(cache_creation)     AS cacheCreation,
           MIN(ts)                 AS firstTs,
           MAX(ts)                 AS lastTs
    FROM token_usage WHERE folder_id = ?
    GROUP BY COALESCE(topic, '')
    ORDER BY outputTokens DESC`).all(folderId)
}

// --- rules ---------------------------------------------------------------
const rowToRule = r => r && ({
  id: r.id, folderId: r.folder_id, kinds: JSON.parse(r.kinds), pathGlob: r.path_glob,
  thresholdCount: r.threshold_count, thresholdSeconds: r.threshold_seconds,
  actions: JSON.parse(r.actions), label: r.label, enabled: !!r.enabled
})

export function listRules (db) {
  return db.prepare('SELECT * FROM rules ORDER BY created_at').all().map(rowToRule)
}

export function addRule (db, r) {
  const id = r.id || randomUUID()
  db.prepare(`INSERT INTO rules (id,folder_id,kinds,path_glob,threshold_count,threshold_seconds,actions,label,enabled,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, r.folderId ?? null, JSON.stringify(r.kinds ?? []), r.pathGlob ?? '**',
         r.thresholdCount ?? null, r.thresholdSeconds ?? null,
         JSON.stringify(r.actions ?? ['toast']), r.label ?? '', r.enabled === false ? 0 : 1, Date.now())
  return rowToRule(db.prepare('SELECT * FROM rules WHERE id=?').get(id))
}

export function patchRule (db, id, fields) {
  const cur = db.prepare('SELECT * FROM rules WHERE id=?').get(id)
  if (!cur) return null
  db.prepare('UPDATE rules SET enabled=?, label=?, path_glob=?, kinds=? WHERE id=?')
    .run(fields.enabled ?? cur.enabled ? 1 : 0, fields.label ?? cur.label,
         fields.pathGlob ?? cur.path_glob,
         JSON.stringify(fields.kinds ?? JSON.parse(cur.kinds)), id)
  return rowToRule(db.prepare('SELECT * FROM rules WHERE id=?').get(id))
}

export function removeRule (db, id) {
  return db.prepare('DELETE FROM rules WHERE id=?').run(id).changes > 0
}

export function countRules (db) {
  return db.prepare('SELECT COUNT(*) AS n FROM rules').get().n
}
