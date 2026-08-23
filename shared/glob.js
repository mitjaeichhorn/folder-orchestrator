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

// Markdown extensions the server will serve as text. Same contract as images:
// shared so the client never asks for something the server would refuse.
export const MARKDOWN_EXTS = ['.md', '.markdown', '.mdown', '.mkd']

export function isMarkdownPath (p) {
  if (typeof p !== 'string') return false
  const i = p.lastIndexOf('.')
  return i !== -1 && MARKDOWN_EXTS.includes(p.slice(i).toLowerCase())
}

/** A file longer than this is flagged as worth splitting. */
export const LINE_ALERT_AT = 1000

/**
 * Extensions exempt from the long-file alert, because length is normal for them
 * rather than a smell:
 *
 * - `.py` and markdown — the operator's call.
 * - `.json` / `.jsonl` — data, not code. A line-delimited log is thousands of
 *   lines *by definition*; measured on prj04-ecommerce, the five longest files
 *   in the project were all append-only `.jsonl` logs, which would have made the
 *   alert read as noise on its first run.
 * - `.html` — markup length says nothing about complexity.
 */
export const LINE_ALERT_EXEMPT = [
  '.py', '.pyi', '.pyw',
  ...MARKDOWN_EXTS,
  '.json', '.jsonl',
  '.html', '.htm'
]

/** Should this path be measured for the long-file alert at all? */
export function countsForLineAlert (p) {
  if (typeof p !== 'string') return false
  const i = p.lastIndexOf('.')
  if (i === -1) return false                    // no extension: not source we judge
  return !LINE_ALERT_EXEMPT.includes(p.slice(i).toLowerCase())
}
