import { readdirSync, statSync, existsSync, openSync, readSync, closeSync, watch, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import * as bus from './bus.js'
import { relabelEvent, updateEventDetail, insertUsage, markDuring } from './db.js'
import { log } from './log.js'

const ROOT = process.env.ORCH_CLAUDE_DIR || join(homedir(), '.claude', 'projects')
const MATCH_WINDOW = 5000        // the exact-path join
const RECENT_TTL = 30000
const MAX_RECENT = 2000          // ceiling for a call that never closes
const CONTAIN_GRACE = 2000       // measured: 8% of changes land within 2s AFTER a call ends
// The watcher's 50ms debounce pushes fs timestamps LATER, never earlier, so no
// lead tolerance is justified by the data. The knob exists; the value does not.
const CONTAIN_LEAD = 0
const CLOSED_TTL = 30000
const MAX_CLOSED = 200
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
// folderId -> [{eventId, start, end, sessionId, topic}] for calls that have CLOSED.
// A file change can arrive after the call it sat inside already finished; without
// this it could never be joined, because closeToolCall has already run.
const closed = new Map()
let db = null
export function init (database) { db = database }

const clip = s => (typeof s === 'string' && s.length > MAX_STR
  ? { text: s.slice(0, MAX_STR), truncated: true } : { text: s })

// The topic is whatever the operator last typed. Claude Code writes it verbatim
// as a `last-prompt` record; we carry it forward onto every action that follows.
// This is transcription, not inference — no summarisation anywhere.
const topics = new Map() // sessionId -> current topic string

/**
 * A message sent mid-turn never produces a `last-prompt` record — it is stored
 * as an attachment of type `queued_command`. Without this, every interjection is
 * invisible to the topic tracker and its work is billed to whatever topic was
 * active when the turn began. Verified: 33 of them in one session.
 */
export function topicFromRecord (o) {
  if (o.type === 'last-prompt' && o.lastPrompt) return textOf(o.lastPrompt)
  if (o.type === 'attachment') {
    const a = o.attachment
    if (a?.type === 'queued_command' && a.commandMode === 'prompt') return textOf(a.prompt)
  }
  return null
}

/** `prompt` is a plain string, or content blocks when the message carried an image. */
function textOf (p) {
  if (typeof p === 'string') return p
  if (Array.isArray(p)) return p.filter(b => b?.type === 'text').map(b => b.text ?? '').join(' ')
  return ''
}

const asTopic = raw => {
  const first = String(raw ?? '').trim().split('\n').find(l => l.trim()) ?? ''
  return first.slice(0, TOPIC_MAX)
}
export const topicOf = sessionId => topics.get(sessionId) ?? null
export const _setTopic = (sessionId, topic) => topics.set(sessionId, topic)
const TOPIC_MAX = 160

export function parseLine (line, folderId) {
  let o
  try { o = JSON.parse(line) } catch { return { skip: 'bad_json' } }
  const ts = o.timestamp ? Date.parse(o.timestamp) : Date.now()
  const sessionId = o.sessionId || null

  const marker = topicFromRecord(o)
  if (marker !== null) {
    const topic = asTopic(marker)
    if (sessionId && topic) topics.set(sessionId, topic)
    return { skip: 'topic_recorded', topic }
  }

  if (o.type === 'assistant') {
    // Every assistant record carries a usage block. It belongs to the turn, not
    // to any one tool call, so it goes to its own table rather than the event
    // stream — 533 usage rows would drown the feed.
    const u = o.message?.usage
    const usage = u && {
      folderId, ts, sessionId, topic: topicOf(sessionId),
      messageId: o.message?.id ?? o.requestId ?? null,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      thinkingTokens: u.output_tokens_details?.thinking_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheCreation: u.cache_creation_input_tokens ?? 0
    }
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
    return { events: out, usage }
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

/**
 * A 30s TTL was fine when `recent` only served a ±5s join. It is wrong for
 * containment: a Bash running a test suite routinely exceeds 30s, so every file it
 * touched would be evicted BEFORE closeToolCall could sweep — silently losing
 * exactly the long calls where nesting matters most. Never evict a change that a
 * still-open call could turn out to contain. MAX_RECENT is the backstop for a call
 * that never closes: a memory ceiling beats completeness.
 */
function pruneRecent (folderId, now) {
  const list = recent.get(folderId) || []
  let oldestOpen = Infinity
  for (const f of inFlight.values()) {
    if (f.folderId === folderId && f.ts < oldestOpen) oldestOpen = f.ts
  }
  const cut = Math.min(now - RECENT_TTL, oldestOpen)
  while (list.length && list[0].ts < cut) list.shift()
  while (list.length > MAX_RECENT) list.shift()
}

function pushClosed (folderId, win) {
  if (!closed.has(folderId)) closed.set(folderId, [])
  const list = closed.get(folderId)
  list.push(win)
  const cut = win.end - CLOSED_TTL
  while (list.length && list[0].end < cut) list.shift()
  while (list.length > MAX_CLOSED) list.shift()
}

const contains = (win, ts) => ts >= win.start - CONTAIN_LEAD && ts <= win.end + CONTAIN_GRACE

/**
 * Which closed call contained this timestamp. Returns null when none did.
 *
 * With several candidates the LABEL still stands — a call was running, that is a
 * fact — but the parent is null: "during Claude", never "during *this* call".
 */
function containedBy (folderId, ts) {
  const hits = (closed.get(folderId) || []).filter(w => contains(w, ts))
  if (!hits.length) return null
  const one = hits.length === 1 ? hits[0] : null
  return {
    sessionId: one?.sessionId ?? null,
    topic: one?.topic ?? null,
    duringToolEventId: one?.eventId ?? null,
    candidates: hits.length
  }
}

/** True when a still-open call could also turn out to contain this timestamp. */
function openRivals (folderId, ts, exceptEventId) {
  let n = 0
  for (const f of inFlight.values()) {
    if (f.folderId === folderId && f.eventId !== exceptEventId && ts >= f.ts - CONTAIN_LEAD) n++
  }
  return n
}

/** Label a filesystem event as having occurred during a Claude call. */
function applyDuring (folderId, eventId, info) {
  if (!db || !markDuring(db, eventId, info)) return false
  bus.patch(folderId, eventId, {
    actor: 'during-claude',
    sessionId: info.sessionId,
    topic: info.topic,
    duringToolEventId: info.duringToolEventId
  })
  log('INFO', 'contained', {
    folder_id: folderId, event_id: eventId,
    during_tool_event_id: info.duringToolEventId, candidates: info.candidates
  })
  return true
}

export function noteFsEvent (folderId, id, absPath, ts) {
  if (!recent.has(folderId)) recent.set(folderId, [])
  recent.get(folderId).push({ id, absPath, ts })
  pruneRecent(folderId, ts)
  // forward direction: the containing call has already closed
  const hit = containedBy(folderId, ts)
  if (hit) applyDuring(folderId, id, hit)
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
      if (initial) { primeTopics(file, folderId); continue }
    }
    const state = t.files.get(name)
    for (const line of readFrom(file, state)) {
      const { events, skip, results, usage } = parseLine(line, folderId)
      if (usage && db) {
        try { insertUsage(db, usage) } catch (err) { log('ERROR', 'usage_insert', { message: err.message }) }
      }
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
          inFlight.set(tid, {
            eventId: emitted.id, folderId, ts: ev.ts,
            sessionId: ev.sessionId ?? null, topic: ev.topic ?? null
          })
          // bounded: a session that never returns must not grow this forever
          if (inFlight.size > MAX_INFLIGHT) inFlight.delete(inFlight.keys().next().value)
        }
      }
    }
  }
}

// Tailing starts at EOF, so everything already written is invisible: the topic
// for the turn in progress, and every token the session has spent. Both matter,
// so on first tail we read the whole file once. Usage rows are deduped by
// message_id, which makes this idempotent across restarts.
export function primeTopics (file, folderId = null) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { return 0 }
  let found = 0
  let usageRows = 0
  for (const line of text.split('\n')) {
    if (!line) continue
    // cheap pre-filter: most lines are neither, and JSON.parse is the expensive part
    if (!line.includes('last-prompt') && !line.includes('queued_command') && !line.includes('"usage"')) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    const sid = o.sessionId || null
    const marker = topicFromRecord(o)
    if (marker !== null) {
      const topic = asTopic(marker)
      if (sid && topic) { topics.set(sid, topic); found++ }
      continue
    }
    if (o.type === 'assistant' && o.message?.usage && folderId && db) {
      const u = o.message.usage
      try {
        const added = insertUsage(db, {
          folderId,
          ts: o.timestamp ? Date.parse(o.timestamp) : Date.now(),
          sessionId: sid,
          topic: topicOf(sid),
          messageId: o.message?.id ?? o.requestId ?? null,
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          thinkingTokens: u.output_tokens_details?.thinking_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheCreation: u.cache_creation_input_tokens ?? 0
        })
        if (added) usageRows++
      } catch { /* a malformed row must not stop the backfill */ }
    }
  }
  if (usageRows) log('INFO', 'usage_backfilled', { file, rows: usageRows })
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

  // The window is only measurable now, so sweep BACKWARDS over changes that
  // happened while this call was running.
  const win = {
    eventId: start.eventId, start: start.ts, end: start.ts + durationMs,
    sessionId: start.sessionId ?? null, topic: start.topic ?? null
  }
  pushClosed(start.folderId, win)

  let contained = 0
  for (const r of (recent.get(start.folderId) || [])) {
    if (!contains(win, r.ts)) continue
    // A sibling still running could also contain this row. Claiming it now would
    // hand out a parent on a coin flip — the label stands, the parent does not.
    const rivals = openRivals(start.folderId, r.ts, win.eventId)
    const ok = applyDuring(start.folderId, r.id, {
      sessionId: rivals ? null : win.sessionId,
      topic: rivals ? null : win.topic,
      duringToolEventId: rivals ? null : win.eventId,
      candidates: rivals + 1
    })
    if (ok) contained++
  }
  if (contained) {
    log('INFO', 'containment_sweep', {
      folder_id: start.folderId, event_id: start.eventId, contained
    })
  }
  return { eventId: start.eventId, durationMs, contained }
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
  closed.delete(folderId)
  return true
}

export function _recent (folderId) { return recent.get(folderId) || [] }

/** Test hooks: drive the containment machinery without a real transcript file. */
export function _openCall (folderId, toolUseId, eventId, ts, sessionId = null, topic = null) {
  inFlight.set(toolUseId, { eventId, folderId, ts, sessionId, topic })
}
export function _reset (folderId) {
  recent.delete(folderId); closed.delete(folderId)
  for (const [k, v] of inFlight) if (v.folderId === folderId) inFlight.delete(k)
}
