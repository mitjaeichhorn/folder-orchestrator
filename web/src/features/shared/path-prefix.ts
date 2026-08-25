/**
 * Splitting a path into the folder prefixes you can point at.
 *
 * Hovering `internal` inside
 * `.claude/worktrees/images-reorg/apps/app__image_generator/internal/routes/x.py`
 * means "everything up to and including internal" — so the answer is a prefix,
 * not a segment. Rows elsewhere on screen share that prefix or they do not.
 *
 * Kept free of runtime imports so it stays directly testable, like `authored`.
 */

export interface PathSegment {
  /** The text of this segment. */
  name: string
  /** Everything up to and including it — what hovering it means. */
  prefix: string
  /** The last segment is the file; the rest are folders. */
  isFile: boolean
}

export function segmentsOf (path: string): PathSegment[] {
  const parts = String(path ?? '').split('/').filter(Boolean)
  const out: PathSegment[] = []
  let prefix = ''
  parts.forEach((name, i) => {
    prefix = prefix ? `${prefix}/${name}` : name
    out.push({ name, prefix, isFile: i === parts.length - 1 })
  })
  return out
}

/**
 * Does this path sit under that prefix?
 *
 * Compares whole segments, so `app` never matches `app__image_generator` — the
 * bug a `startsWith` would ship, and these trees are full of names that share a
 * leading word.
 */
export function sharesPrefix (path: string, prefix: string | null | undefined): boolean {
  if (!prefix || !path) return false
  return path === prefix || path.startsWith(prefix + '/')
}

/** How many leading segments of `path` the prefix covers; 0 when it does not. */
export function prefixDepth (path: string, prefix: string | null | undefined): number {
  if (!sharesPrefix(path, prefix)) return 0
  return String(prefix).split('/').filter(Boolean).length
}
