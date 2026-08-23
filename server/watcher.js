import { watch, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { compile, shouldIgnore } from './ignore.js'
import { decide, sweepPending } from './normalise.js'
import * as bus from './bus.js'
import { noteFsEvent } from './transcripts.js'
import { log } from './log.js'

const DEBOUNCE = 50
const RATE_LIMIT = 500
const RATE_WINDOW = 10000

const watchers = new Map() // folderId -> state

function walk (root, compiled, seen, budget = { n: 0 }) {
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const abs = join(root, e.name)
    const rel = relative(seen.root, abs).split(sep).join('/')
    if (shouldIgnore(rel, compiled)) continue
    // ino recorded here so a rename of a pre-existing file is still detectable
    let ino = null
    try { ino = statSync(abs).ino } catch {}
    seen.map.set(rel, ino)
    budget.n++
    if (e.isDirectory()) walk(abs, compiled, seen, budget)
  }
  return budget.n
}

export function startWatch (folder) {
  if (watchers.has(folder.id)) return watchers.get(folder.id)
  const compiled = compile(folder)
  const seen = { root: folder.path, map: new Map() }
  const t0 = Date.now()
  const fileCount = walk(folder.path, compiled, seen) ?? 0
  const st = {
    folder,
    compiled,
    seen: seen.map,
    timers: new Map(),
    pendingDeletes: new Map(),
    rate: [],
    collapsed: 0,
    collapsedMode: false,
    quietTicks: 0,
    fileCount,
    handle: null,
    watching: false,
    reason: null
  }
  watchers.set(folder.id, st)

  try {
    st.handle = watch(folder.path, { recursive: true }, (_type, filename) => {
      if (!filename) return
      onRaw(st, filename.split(sep).join('/'))
    })
    st.handle.on('error', err => {
      log('WARN', 'watch_error', { folder_id: folder.id, message: err.message })
      stopWatch(folder.id, 'root_vanished')
    })
    st.watching = true
  } catch (err) {
    st.reason = err.code || err.message
    log('ERROR', 'watch_start', { folder_id: folder.id, path: folder.path, message: err.message })
  }
  log('INFO', 'watch_started', {
    folder_id: folder.id, path: folder.path, file_count: fileCount,
    duration_ms: Date.now() - t0, watching: st.watching
  })
  return st
}

function onRaw (st, rel) {
  if (shouldIgnore(rel, st.compiled)) { st.ignoredCount = (st.ignoredCount || 0) + 1; return }
  const existing = st.timers.get(rel)
  if (existing) clearTimeout(existing)
  st.timers.set(rel, setTimeout(() => { st.timers.delete(rel); flush(st, rel) }, DEBOUNCE))
}

function flush (st, rel) {
  const abs = join(st.folder.path, rel)
  const d = decide(abs, rel, st.seen, st.pendingDeletes)
  if (!d) return
  if (!rateOk(st)) { st.collapsed++; return }
  log('DEBUG', 'normalise', { path: rel, kind: d.kind, why: d.why })
  const ev = bus.emit({
    folderId: st.folder.id, ts: Date.now(), kind: d.kind,
    path: rel, actor: 'external', detail: d.detail
  })
  // register for the attribution join — a transcript tool call may relabel this
  if (ev.id) noteFsEvent(st.folder.id, ev.id, abs, ev.ts)
}

function rateOk (st) {
  const now = Date.now()
  st.rate = st.rate.filter(t => now - t < RATE_WINDOW)
  st.rate.push(now)
  if (st.rate.length > RATE_LIMIT) {
    if (!st.collapsedMode) {
      st.collapsedMode = true
      log('WARN', 'rate_ceiling_enter', { folder_id: st.folder.id, events_in_window: st.rate.length })
    }
    return false
  }
  return true
}

function tick (st) {
  // collapsed-mode drain: one summary row per second, never a silent drop
  if (st.collapsedMode) {
    if (st.collapsed > 0) {
      bus.emit({
        folderId: st.folder.id, ts: Date.now(), kind: 'modified', path: null,
        actor: 'unknown', detail: { collapsed: st.collapsed }
      })
      log('WARN', 'rate_ceiling_collapse', { folder_id: st.folder.id, dropped: st.collapsed })
      st.collapsed = 0
      st.quietTicks = 0
    } else if (++st.quietTicks >= 2) {
      st.collapsedMode = false
      st.quietTicks = 0
      log('INFO', 'rate_ceiling_exit', { folder_id: st.folder.id })
    }
  }
  sweepPending(st.pendingDeletes)
}

export function status (folderId) {
  const st = watchers.get(folderId)
  if (!st) return { folderId, watching: false, fileCount: 0, eventsPerMin: 0 }
  const now = Date.now()
  st.rate = st.rate.filter(t => now - t < RATE_WINDOW)
  return {
    folderId, watching: st.watching, reason: st.reason,
    fileCount: st.fileCount,
    eventsPerMin: Math.round(st.rate.length * (60000 / RATE_WINDOW))
  }
}

export function stopWatch (folderId, reason) {
  const st = watchers.get(folderId)
  if (!st) return false
  try { st.handle?.close() } catch {}
  for (const t of st.timers.values()) clearTimeout(t)
  st.timers.clear()
  watchers.delete(folderId)
  log(reason ? 'WARN' : 'INFO', reason || 'watch_stopped', { folder_id: folderId })
  return true
}

export function seenPaths (folderId) { return watchers.get(folderId)?.seen }
export function watchedFolders () { return [...watchers.values()].map(s => s.folder) }

let ticker = null
export function startTicker () {
  if (ticker) return
  ticker = setInterval(() => {
    for (const st of watchers.values()) {
      tick(st)
      if (bus.hasSubs(st.folder.id)) bus.send(st.folder.id, 'status', status(st.folder.id))
    }
  }, 1000)
  ticker.unref?.()
}
export function stopTicker () { if (ticker) { clearInterval(ticker); ticker = null } }
