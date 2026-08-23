import { readdirSync, statSync, openSync, readSync, closeSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { compile, shouldIgnore } from './ignore.js'
import { countsForLineAlert, LINE_ALERT_AT } from '../shared/glob.js'
import { log } from './log.js'

export const MAX_NODES = 12000
export const MAX_DEPTH = 24

/** Reading a file this large to count its lines is not worth it. */
const MAX_COUNT_BYTES = 4 * 1024 * 1024

/**
 * Line counts, keyed by path + mtime + size.
 *
 * The tree is refetched on every structural change, and re-reading ~1800 files
 * each time is the difference between a 90ms walk and a 320ms one. A file whose
 * mtime and size both match is byte-identical for our purposes, so the count is
 * reused; any real edit changes the mtime and evicts the entry by missing.
 */
const lineCache = new Map()
const MAX_CACHE = 20000

/**
 * Lines in a file, or null when we decline to say.
 *
 * Three prefilters, cheapest first, because this runs across the whole project:
 * the extension exemption, then size — a file under LINE_ALERT_AT bytes cannot
 * hold that many newlines, which is a bound rather than a guess — and finally a
 * NUL-byte probe. Without that last one a SQLite file or a browser cache blob
 * counts its binary noise as lines and tops the list, which is what the first
 * measurement did.
 */
function countLines (abs, rel, size) {
  if (!countsForLineAlert(rel)) return null
  if (size < LINE_ALERT_AT || size > MAX_COUNT_BYTES) return null
  const key = `${rel}\0${size}`
  const hit = lineCache.get(key)
  if (hit !== undefined) return hit
  let lines = null
  try {
    const fd = openSync(abs, 'r')
    try {
      const probe = Buffer.allocUnsafe(Math.min(8192, size))
      const read = readSync(fd, probe, 0, probe.length, 0)
      if (probe.subarray(0, read).includes(0)) return null      // binary
    } finally { closeSync(fd) }
    let n = 0
    for (const b of readFileSync(abs)) if (b === 10) n++
    lines = n
  } catch { return null }                                        // vanished, unreadable
  if (lineCache.size >= MAX_CACHE) lineCache.clear()
  lineCache.set(key, lines)
  return lines
}

/**
 * The project's directory tree, ignore rules applied — the same rules the
 * watcher uses, so the heatmap can never show a path that will never light up.
 *
 * Capped at MAX_NODES. When the cap is hit the response says so explicitly:
 * a silently truncated tree reads as "that's the whole project".
 */
export function buildTree (folder) {
  const compiled = compile(folder)
  const state = { count: 0, truncated: false }

  const walk = (abs, depth) => {
    if (depth > MAX_DEPTH) { state.truncated = true; return [] }
    let entries
    try { entries = readdirSync(abs, { withFileTypes: true }) } catch { return [] }
    const out = []
    entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
    for (const e of entries) {
      if (state.count >= MAX_NODES) { state.truncated = true; break }
      const childAbs = join(abs, e.name)
      const rel = relative(folder.path, childAbs).split(sep).join('/')
      if (shouldIgnore(rel, compiled)) continue
      state.count++
      if (e.isDirectory()) out.push({ n: e.name, p: rel, d: 1, c: walk(childAbs, depth + 1) })
      else {
        // mtime is the filesystem's own record of when a file last changed, so
        // the By-file view can rank every file — including ones this tool has
        // never seen change, because it was not watching at the time.
        let m = 0
        let size = 0
        try {
          const st = statSync(childAbs)
          m = Math.round(st.mtimeMs)
          size = st.size
        } catch { /* vanished mid-walk */ }
        const node = { n: e.name, p: rel, d: 0, m }
        // Only present when we actually measured it. Absent means "not judged"
        // — an exempt extension, a binary, or a file too large to be worth
        // reading — which the client must not confuse with "short".
        const lines = countLines(childAbs, rel, size)
        if (lines !== null) node.l = lines
        out.push(node)
      }
    }
    return out
  }

  const t0 = Date.now()
  const children = walk(folder.path, 0)
  log('INFO', 'tree_built', {
    folder_id: folder.id, nodes: state.count, truncated: state.truncated, duration_ms: Date.now() - t0
  })
  return { nodes: state.count, truncated: state.truncated, children }
}
