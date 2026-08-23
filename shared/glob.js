// Single source for glob matching and event filtering.
// Imported by server/ignore.js AND web/src — two implementations would drift,
// and a client filter that disagrees with the server's is a silent wrong answer.

export function globToRe (glob) {
  let g = String(glob).trim()
  const dirOnly = g.endsWith('/')
  if (dirOnly) g = g.slice(0, -1)
  const anchored = g.startsWith('/')
  if (anchored) g = g.slice(1)
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++ }
      else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  const body = anchored ? `^${re}` : `(^|/)${re}`
  return new RegExp(`${body}(/|$)`, 'i')
}

export const ALL_KINDS = ['created', 'modified', 'deleted', 'renamed', 'tool', 'prompt', 'alert']

/**
 * The one predicate. Used by the feed, the session view, and the server query.
 * @param {object} e     event
 * @param {object} f     {kinds?: string[], pathGlob?: string, since?: number, actor?: string, sessionId?: string}
 */
export function matchEvent (e, f = {}) {
  if (f.kinds?.length && !f.kinds.includes(e.kind)) return false
  if (f.actor && e.actor !== f.actor) return false
  if (f.sessionId && e.sessionId !== f.sessionId) return false
  if (f.since && e.ts < f.since) return false
  if (f.pathGlob && f.pathGlob !== '**') {
    if (e.path == null) return false
    if (!globToRe(f.pathGlob).test(e.path)) return false
  }
  return true
}

// Image extensions the server will serve. Shared so the client never renders a
// thumbnail for something the server would refuse.
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp']

export function isImagePath (p) {
  if (typeof p !== 'string') return false
  const i = p.lastIndexOf('.')
  return i !== -1 && IMAGE_EXTS.includes(p.slice(i).toLowerCase())
}
