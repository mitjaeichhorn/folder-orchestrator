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
 * Never measured at all — documents and data, where length says nothing.
 *
 * `.jsonl` sits here with `.json` for a reason found by measuring: a
 * line-delimited log is thousands of lines *by definition*, and on
 * prj04-ecommerce the five longest files in the project were all append-only
 * `.jsonl` logs, which would have made the alert read as noise on its first run.
 */
export const LINE_MEASURE_EXEMPT = [
  ...MARKDOWN_EXTS,
  '.json', '.jsonl',
  '.html', '.htm'
]

/**
 * Measured, but not badged in the default view — the operator's call that a long
 * python file is normal. They stay counted so the executables filter can show
 * them, which is the whole reason measurement and display are separate lists.
 */
export const LINE_BADGE_EXEMPT = ['.py', '.pyi', '.pyw']

/** Kept for callers that want the default view's full exclusion set. */
export const LINE_ALERT_EXEMPT = [...LINE_MEASURE_EXEMPT, ...LINE_BADGE_EXEMPT]

/**
 * Code that runs, as opposed to markup, styles, data and lock files.
 *
 * The distinction earns its place: filtering prj04-ecommerce's long files by it
 * drops four near-identical vendored `base.css` copies and a `uv.lock`, which
 * are long because they are generated, not because anyone should split them.
 */
export const EXECUTABLE_EXTS = [
  '.py', '.pyi', '.pyw',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.scala',
  '.c', '.cc', '.cpp', '.h', '.hpp', '.cs',
  '.php', '.pl', '.lua', '.ex', '.exs',
  '.sh', '.bash', '.zsh',
  '.vue', '.svelte'
]

const extOf = p => {
  if (typeof p !== 'string') return null
  const i = p.lastIndexOf('.')
  if (i === -1) return null
  const slash = p.lastIndexOf('/')
  if (i < slash) return null                    // ".../my.dir/README" has no extension
  return p.slice(i).toLowerCase()
}

/** Does this file run? */
export function isExecutablePath (p) {
  const e = extOf(p)
  return e !== null && EXECUTABLE_EXTS.includes(e)
}

/** Is this file exempt from the badge in the default view? */
export function isBadgeExempt (p) {
  const e = extOf(p)
  return e === null || LINE_ALERT_EXEMPT.includes(e)
}

/** Should this path be measured at all? Python IS measured — see the two lists. */
export function countsForLineAlert (p) {
  const e = extOf(p)
  if (e === null) return false                  // no extension: not source we judge
  return !LINE_MEASURE_EXEMPT.includes(e)
}
