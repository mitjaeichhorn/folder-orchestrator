import { insertEvent } from './db.js'
import { log } from './log.js'

const KINDS = new Set(['created', 'modified', 'deleted', 'renamed', 'tool', 'prompt', 'alert'])
const subs = new Map() // folderId -> Set<res>
let db = null
let matcher = null // set by rules.js; runs after the ignore filter, before fan-out
let pinger = null

export function init (database) { db = database }
export function setMatcher (fn) { matcher = fn }

export function subscribe (folderId, res) {
  if (!subs.has(folderId)) subs.set(folderId, new Set())
  const set = subs.get(folderId)
  set.add(res)
  log('INFO', 'sub_open', { folder_id: folderId, count: set.size })
  res.on('close', () => {
    set.delete(res)
    if (set.size === 0) subs.delete(folderId)
    log('INFO', 'sub_close', { folder_id: folderId, count: set.size })
  })
  startPing()
}

export function size (folderId) { return subs.get(folderId)?.size ?? 0 }
export function hasSubs (folderId) { return size(folderId) > 0 }

function write (res, type, payload) {
  try {
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
    return true
  } catch { return false }
}

export function send (folderId, type, payload) {
  const set = subs.get(folderId)
  if (!set) return 0
  let n = 0
  for (const res of [...set]) {
    if (write(res, type, payload)) n++
    else { set.delete(res); log('INFO', 'sub_dropped', { folder_id: folderId }) }
  }
  if (set.size === 0) subs.delete(folderId)
  return n
}

export function emit (e) {
  if (!KINDS.has(e.kind)) log('WARN', 'unknown_kind', { kind: e.kind, path: e.path })
  e.ts ??= Date.now()
  e.actor ??= 'unknown'
  try {
    if (db) e.id = insertEvent(db, e)
  } catch (err) {
    // History loss beats liveness loss — fan out anyway.
    log('ERROR', 'emit_insert', { message: err.message, kind: e.kind, path: e.path })
  }
  const n = send(e.folderId, 'append', e)
  log('DEBUG', 'emit', { folder_id: e.folderId, kind: e.kind, path: e.path, actor: e.actor, subscriber_count: n })
  if (matcher) {
    try { matcher(e) } catch (err) { log('ERROR', 'matcher_threw', { message: err.message }) }
  }
  return e
}

export function patch (folderId, id, fields) {
  send(folderId, 'patch', { id, ...fields })
}

// ponytail: one shared keepalive interval, not one timer per subscriber.
function startPing () {
  if (pinger) return
  pinger = setInterval(() => {
    if (subs.size === 0) { clearInterval(pinger); pinger = null; return }
    for (const set of subs.values()) for (const res of set) { try { res.write(':ping\n\n') } catch {} }
  }, 25000)
  pinger.unref?.()
}

export function _reset () { subs.clear(); if (pinger) { clearInterval(pinger); pinger = null } }
