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
}

const rowToFolder = r => r && ({
  id: r.id, path: r.path, name: r.name,
  ignore: JSON.parse(r.ignore), enabled: !!r.enabled, createdAt: r.created_at
})

const rowToEvent = r => ({
  id: r.id, folderId: r.folder_id, ts: r.ts, kind: r.kind, path: r.path,
  actor: r.actor, sessionId: r.session_id, tool: r.tool, topic: r.topic,
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
    'INSERT INTO events (folder_id,ts,kind,path,actor,session_id,tool,topic,detail) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(e.folderId, e.ts, e.kind, e.path ?? null, e.actor ?? 'unknown',
        e.sessionId ?? null, e.tool ?? null, e.topic ?? null, JSON.stringify(e.detail ?? {}))
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

export function relabelEvent (db, id, { actor, sessionId, topic }) {
  db.prepare('UPDATE events SET actor=?, session_id=?, topic=COALESCE(?, topic) WHERE id=?')
    .run(actor, sessionId ?? null, topic ?? null, id)
}

/** Merge fields into an event's detail. Used to close a running tool call. */
export function updateEventDetail (db, id, patch) {
  const row = db.prepare('SELECT detail FROM events WHERE id = ?').get(id)
  if (!row) return null
  const detail = { ...JSON.parse(row.detail), ...patch }
  db.prepare('UPDATE events SET detail = ? WHERE id = ?').run(JSON.stringify(detail), id)
  return detail
}

export function sessions (db, folderId, limit = 20) {
  return db.prepare(
    `SELECT session_id AS id, MIN(ts) AS startedAt, MAX(ts) AS lastAt, COUNT(*) AS events,
            COUNT(DISTINCT path) AS files
     FROM events WHERE folder_id = ? AND session_id IS NOT NULL
     GROUP BY session_id ORDER BY lastAt DESC LIMIT ?`
  ).all(folderId, limit)
}

export function sweepRetention (db, days = 30, now = Date.now()) {
  const cutoff = now - days * 86400000
  return db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff).changes
}

// --- token usage ---------------------------------------------------------
/**
 * message_id is UNIQUE and the insert is OR IGNORE: re-reading a transcript
 * (rotation, restart, a second folder pointing at the same project) must never
 * double-count tokens.
 */
export function insertUsage (db, u) {
  const r = db.prepare(`INSERT OR IGNORE INTO token_usage
      (folder_id,ts,session_id,topic,message_id,input_tokens,output_tokens,thinking_tokens,cache_read,cache_creation)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(u.folderId, u.ts, u.sessionId ?? null, u.topic ?? null, u.messageId ?? null,
         u.inputTokens | 0, u.outputTokens | 0, u.thinkingTokens | 0, u.cacheRead | 0, u.cacheCreation | 0)
  return r.changes > 0
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
