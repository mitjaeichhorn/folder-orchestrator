import { readdirSync, statSync, existsSync, openSync, readSync, closeSync, watch } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import * as bus from './bus.js'
import { relabelEvent, updateEventDetail } from './db.js'
import { log } from './log.js'

const ROOT = process.env.ORCH_CLAUDE_DIR || join(homedir(), '.claude', 'projects')
const MATCH_WINDOW = 5000
const RECENT_TTL = 30000
const MAX_STR = 4096

// Verified against the 50 real directories on this machine.
export const slugify = p => p.replace(/[^a-zA-Z0-9]/g, '-')

// Tool -> path extractor. A table, not a heuristic: an unknown tool yields no path.
const PATH_OF = {
  Edit: i => i?.file_path, Write: i => i?.file_path, Read: i => i?.file_path,
  NotebookEdit: i => i?.notebook_path ?? i?.file_path, MultiEdit: i => i?.file_path
}

const tailers = new Map() // folderId -> {dir, files: Map<name,{ino,offset,buf}>, handle}
// toolUseId -> {eventId, folderId, ts}. A tool call is written to the transcript
// when it STARTS; its result lands later with the same id, so the pair gives a
// real duration and lets the UI show work in progress rather than after the fact.
const inFlight = new Map()
const MAX_INFLIGHT = 500
const recent = new Map()  // folderId -> [{id, absPath, ts}]
let db = null
export function init (database) { db = database }

const clip = s => (typeof s === 'string' && s.length > MAX_STR
  ? { text: s.slice(0, MAX_STR), truncated: true } : { text: s })

// The topic is whatever the operator last typed. Claude Code writes it verbatim
// as a `last-prompt` record; we carry it forward onto every action that follows.
// This is transcription, not inference — no summarisation anywhere.
const topics = new Map() // sessionId -> current topic string
export const topicOf = sessionId => topics.get(sessionId) ?? null
export const _setTopic = (sessionId, topic) => topics.set(sessionId, topic)
const TOPIC_MAX = 160

export function parseLine (line, folderId) {
  let o
  try { o = JSON.parse(line) } catch { return { skip: 'bad_json' } }
  const ts = o.timestamp ? Date.parse(o.timestamp) : Date.now()
  const sessionId = o.sessionId || null

  if (o.type === 'last-prompt' && o.lastPrompt) {
    const topic = String(o.lastPrompt).trim().split('\n')[0].slice(0, TOPIC_MAX)
    if (sessionId) topics.set(sessionId, topic)
    return { skip: 'topic_recorded', topic }
  }

  if (o.type === 'assistant') {
    const blocks = Array.isArray(o.message?.content) ? o.message.content : []
    const out = []
    for (const b of blocks) {
      if (b?.type !== 'tool_use') continue
      const path = PATH_OF[b.name]?.(b.input) ?? null
      const detail = { input: {}, state: 'running', toolUseId: b.id ?? null }
      if (b.name === 'Edit' || b.name === 'MultiEdit') {
        const oldS = b.input?.old_string ?? ''
        const newS = b.input?.new_string ?? ''
        detail.input.old_string = clip(oldS)
        detail.input.new_string = clip(newS)
        detail.linesRemoved = oldS ? oldS.split('\n').length : 0
        detail.linesAdded = newS ? newS.split('\n').length : 0
      } else if (b.name === 'Bash') {
        detail.input.command = clip(b.input?.command ?? '').text
        detail.input.description = b.input?.description ?? null
      } else if (path) {
        detail.input.file_path = path
      }
      out.push({
        folderId, ts, kind: 'tool', path, actor: 'claude', sessionId,
        tool: b.name, topic: topicOf(sessionId), detail
      })
    }
    return { events: out }
  }

  // tool_result closes a call that is already on screen
  if (o.type === 'user' && Array.isArray(o.message?.content)) {
    const results = []
    for (const b of o.message.content) {
      if (b?.type !== 'tool_result' || !b.tool_use_id) continue
      results.push({ toolUseId: b.tool_use_id, ts, isError: !!b.is_error })
    }
    return results.length ? { results } : { skip: 'unhandled_type' }
  }

  if (o.type === 'user' && typeof o.message?.content === 'string') {
    const text = o.message.content
    if (sessionId) topics.set(sessionId, text.trim().split('\n')[0].slice(0, TOPIC_MAX))
    return { events: [{ folderId, ts, kind: 'prompt', path: null, actor: 'claude', sessionId,
                        tool: null, topic: topicOf(sessionId), detail: { text: text.slice(0, 200) } }] }
  }

  return { skip: 'unhandled_type' } // contract invariant 4: silent
}

// --- attribution ---------------------------------------------------------
export function noteFsEvent (folderId, id, absPath, ts) {
  if (!recent.has(folderId)) recent.set(folderId, [])
  const list = recent.get(folderId)
  list.push({ id, absPath, ts })
  const cut = ts - RECENT_TTL
  while (list.length && list[0].ts < cut) list.shift()
}

export function attribute (ev) {
  if (!ev.path || !ev.sessionId) return null
  const list = recent.get(ev.folderId) || []
  const hits = list.filter(r => r.absPath === ev.path && Math.abs(r.ts - ev.ts) <= MATCH_WINDOW)
  if (hits.length === 0) {
    log('INFO', 'attribution', { path: ev.path, outcome: 'no_match' })
    return null
  }
  if (hits.length > 1) {
    log('WARN', 'attribution_ambiguous', { path: ev.path, candidates: hits.length })
    return null // fail toward 'external' — a wrong claude label is worse than none
  }
  const hit = hits[0]
  log('INFO', 'attribution', {
    path: ev.path, tool_event_ts: ev.ts, matched_fs_event_id: hit.id,
    delta_ms: ev.ts - hit.ts, outcome: 'relabelled'
  })
  return hit
}

// --- tailing -------------------------------------------------------------
function readFrom (file, state) {
  let st
  try { st = statSync(file) } catch { return [] }
  if (state.ino && (st.ino !== state.ino || st.size < state.offset)) {
    log('INFO', 'transcript_reset', { file, old_ino: state.ino, new_ino: st.ino, old_offset: state.offset })
    state.offset = 0; state.buf = ''
  }
  state.ino = st.ino
  if (st.size <= state.offset) return []
  const len = st.size - state.offset
  const buf = Buffer.alloc(len)
  const fd = openSync(file, 'r')
  try { readSync(fd, buf, 0, len, state.offset) } finally { closeSync(fd) }
  state.offset = st.size
  const text = state.buf + buf.toString('utf8')
  const parts = text.split('\n')
  state.buf = parts.pop() // partial line held back
  return parts.filter(Boolean)
}

function drain (folderId, t, initial = false) {
  let files
  try { files = readdirSync(t.dir).filter(f => f.endsWith('.jsonl')) } catch { return }
  for (const name of files) {
    const file = join(t.dir, name)
    if (!t.files.has(name)) {
      let size = 0
      try { size = statSync(file).size } catch {}
      // start at EOF: never replay history
      t.files.set(name, { ino: null, offset: initial ? size : 0, buf: '' })
      if (initial) { primeTopics(file); continue }
    }
    const state = t.files.get(name)
    for (const line of readFrom(file, state)) {
      const { events, skip, results } = parseLine(line, folderId)
      if (results) { for (const r of results) closeToolCall(folderId, r); continue }
      if (skip) { if (skip === 'bad_json') log('WARN', 'bad_line', { file, first: line.slice(0, 80) }); continue }
      for (const ev of events) {
        const hit = attribute(ev)
        if (hit && db) {
          const patch = { actor: 'claude', sessionId: ev.sessionId, topic: ev.topic }
          relabelEvent(db, hit.id, patch)
          bus.patch(folderId, hit.id, patch)
        }
        // store tool events with the folder-relative path for the UI
        if (ev.path?.startsWith(t.rootPath)) ev.path = ev.path.slice(t.rootPath.length + 1)
        const emitted = bus.emit(ev)
        const tid = ev.detail?.toolUseId
        if (tid && emitted.id) {
          inFlight.set(tid, { eventId: emitted.id, folderId, ts: ev.ts })
          // bounded: a session that never returns must not grow this forever
          if (inFlight.size > MAX_INFLIGHT) inFlight.delete(inFlight.keys().next().value)
        }
      }
    }
  }
}

// Tailing starts at EOF, so the `last-prompt` for the turn already in progress
// is behind us. Without this, the topic stays null until the operator's NEXT
// prompt — and every restart loses it. Read back over the file's tail to
// recover the most recent topic per session.
const PRIME_BYTES = 512 * 1024

export function primeTopics (file) {
  let st
  try { st = statSync(file) } catch { return 0 }
  const start = Math.max(0, st.size - PRIME_BYTES)
  const len = st.size - start
  if (len <= 0) return 0
  const buf = Buffer.alloc(len)
  const fd = openSync(file, 'r')
  try { readSync(fd, buf, 0, len, start) } finally { closeSync(fd) }
  const lines = buf.toString('utf8').split('\n')
  if (start > 0) lines.shift() // first line is probably partial
  let found = 0
  for (const line of lines) {
    if (!line.includes('last-prompt')) continue
    try {
      const o = JSON.parse(line)
      if (o.type === 'last-prompt' && o.lastPrompt && o.sessionId) {
        topics.set(o.sessionId, String(o.lastPrompt).trim().split('\n')[0].slice(0, TOPIC_MAX))
        found++
      }
    } catch { /* partial or malformed line — skip, same as the tailer */ }
  }
  return found
}

/** Close a running tool call: record its duration and tell the UI it finished. */
export function closeToolCall (folderId, { toolUseId, ts, isError }) {
  const start = inFlight.get(toolUseId)
  if (!start) return null   // started before we began tailing — nothing on screen to close
  inFlight.delete(toolUseId)
  const durationMs = Math.max(0, ts - start.ts)
  const patch = { state: isError ? 'error' : 'done', durationMs }
  const detail = db ? updateEventDetail(db, start.eventId, patch) : patch
  bus.patch(start.folderId, start.eventId, { detail })
  log('INFO', 'tool_closed', {
    folder_id: start.folderId, event_id: start.eventId, duration_ms: durationMs, state: patch.state
  })
  return { eventId: start.eventId, durationMs }
}

export function _inFlightSize () { return inFlight.size }

export function startTail (folder) {
  const dir = join(ROOT, slugify(folder.path))
  if (!existsSync(dir)) { log('INFO', 'no_transcripts', { folder_id: folder.id, dir }); return null }
  const t = { dir, rootPath: folder.path, files: new Map(), handle: null }
  tailers.set(folder.id, t)
  drain(folder.id, t, true) // prime offsets at EOF
  try {
    t.handle = watch(dir, () => drain(folder.id, t))
  } catch (err) {
    log('ERROR', 'tail_watch', { dir, message: err.message })
  }
  log('INFO', 'tail_started', {
    folder_id: folder.id, dir, files: t.files.size, topics_primed: topics.size
  })
  return t
}

export function stopTail (folderId) {
  const t = tailers.get(folderId)
  if (!t) return false
  try { t.handle?.close() } catch {}
  tailers.delete(folderId)
  recent.delete(folderId)
  return true
}

export function _recent (folderId) { return recent.get(folderId) || [] }
