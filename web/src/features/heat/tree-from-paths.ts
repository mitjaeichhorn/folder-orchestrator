/**
 * Build a tree from a list of paths.
 *
 * The heat view's default is "Active only" — it renders just the paths that
 * have changed, which the client already knows from the event stream. It does
 * not need the project tree for that, and asking for one is actively harmful on
 * a large repository: `/api/tree` is capped at MAX_NODES, the walk is
 * depth-first in alphabetical order, and on a 16,000-file project the budget
 * was spent entirely on `.claude`, `.claudekit`, `__board` … `admin` before
 * reaching `apps/` or `import-pipeline/`. Every one of the 60 most recently
 * changed paths fell outside the truncated tree, so the heat panel showed
 * "0 paths" while the feed scrolled with changes.
 *
 * Derived from the events, truncation cannot reach it: what changed is always
 * what is shown.
 *
 * A node is a directory when something sits under it, and a file when nothing
 * does. That is a heuristic — an empty directory that was created and never
 * filled reads as a file — and it is the only thing here that guesses. It costs
 * that node its folder chevron; nothing downstream depends on it being right.
 */

export interface PathNode {
  n: string
  p: string
  d: 0 | 1
  c?: PathNode[]
}

export function treeFromPaths (paths: Iterable<string>): PathNode[] {
  interface Build { node: PathNode; kids: Map<string, Build> }
  const roots = new Map<string, Build>()

  for (const path of paths) {
    if (!path) continue
    const parts = path.split('/').filter(Boolean)
    let level = roots
    let prefix = ''
    for (const name of parts) {
      prefix = prefix ? `${prefix}/${name}` : name
      let entry = level.get(name)
      if (!entry) {
        entry = { node: { n: name, p: prefix, d: 0 }, kids: new Map() }
        level.set(name, entry)
      }
      level = entry.kids
    }
  }

  const emit = (level: Map<string, Build>): PathNode[] =>
    [...level.values()]
      .map(({ node, kids }) => {
        if (kids.size === 0) return { ...node, d: 0 as const }
        return { ...node, d: 1 as const, c: emit(kids) }
      })
      // directories first, then alphabetical — the same order the server walk uses
      .sort((a, b) => (b.d - a.d) || a.n.localeCompare(b.n))

  return emit(roots)
}
