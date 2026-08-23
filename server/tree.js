import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { compile, shouldIgnore } from './ignore.js'
import { log } from './log.js'

export const MAX_NODES = 12000
export const MAX_DEPTH = 24

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
        try { m = Math.round(statSync(childAbs).mtimeMs) } catch { /* vanished mid-walk */ }
        out.push({ n: e.name, p: rel, d: 0, m })
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
