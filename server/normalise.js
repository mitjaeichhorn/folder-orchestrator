import { statSync } from 'node:fs'
import { log } from './log.js'

// 500ms, not 100: under heavy filesystem load FSEvents can deliver the delete
// and the create far apart, and the rename is then reported as two events.
// Widening is close to free because matching is by INODE — an inode reappearing
// at a different path IS a rename, so a longer window cannot pair unrelated files.
export const RENAME_WINDOW = 500

// A rename preserves the inode — that is the only honest signal macOS gives us.
// Matching on basename cannot work: a rename is precisely a change of basename.
// `seen` is Map<relPath, ino>; `pendingDeletes` is Map<ino, {relPath, at}>.
export function decide (absPath, relPath, seen, pendingDeletes, {
  statFn = statSync, now = Date.now
} = {}) {
  let st = null
  try {
    st = statFn(absPath)
  } catch (err) {
    if (err.code === 'ENOENT') {
      const ino = seen.get(relPath)
      seen.delete(relPath)
      if (ino != null) pendingDeletes.set(ino, { relPath, at: now() })
      return { kind: 'deleted', detail: {}, why: 'stat_enoent' }
    }
    log('ERROR', 'stat_failed', { path: relPath, code: err.code, message: err.message })
    return null
  }

  const detail = { size: st.size, mtime: st.mtimeMs }

  if (!seen.has(relPath)) {
    seen.set(relPath, st.ino)
    const pending = pendingDeletes.get(st.ino)
    if (pending && now() - pending.at <= RENAME_WINDOW && pending.relPath !== relPath) {
      pendingDeletes.delete(st.ino)
      return { kind: 'renamed', detail: { ...detail, oldPath: pending.relPath }, why: 'rename_collapse' }
    }
    return { kind: 'created', detail, why: 'seen_miss' }
  }
  seen.set(relPath, st.ino)
  return { kind: 'modified', detail, why: 'seen_hit' }
}

export function sweepPending (pendingDeletes, now = Date.now()) {
  const expired = []
  for (const [ino, p] of pendingDeletes) {
    if (now - p.at > RENAME_WINDOW) { expired.push(p); pendingDeletes.delete(ino) }
  }
  return expired
}
