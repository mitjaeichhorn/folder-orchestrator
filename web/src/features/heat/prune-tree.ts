export interface TreeNode { n: string; p: string; d: 0 | 1; c?: TreeNode[] }

/**
 * Keep only branches that have been active. Because every ancestor of a touched
 * path is stamped, filtering on "is stamped" preserves the whole route down to a
 * changed file and drops everything else — no separate descendant search needed.
 */
export function pruneToActive (nodes: TreeNode[], isActive: (path: string) => boolean): TreeNode[] {
  const out: TreeNode[] = []
  for (const n of nodes) {
    if (!isActive(n.p)) continue
    out.push(n.c ? { ...n, c: pruneToActive(n.c, isActive) } : n)
  }
  return out
}

/** Paths of every folder that is active — what "collapse the inactive ones" keeps open. */
export function activeFolders (nodes: TreeNode[], isActive: (path: string) => boolean, acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.d === 1 && isActive(n.p)) acc.push(n.p)
    if (n.c) activeFolders(n.c, isActive, acc)
  }
  return acc
}

/** Every folder path in the tree, regardless of activity. */
export const allFolders = (nodes: TreeNode[]): string[] => activeFolders(nodes, () => true)

/**
 * Only a FILE pulses as "being edited". Directories get their own filesystem
 * events — a mkdir or rmdir emits one with the directory as its path — so
 * without this a single new folder lights up its whole branch.
 */
export function shouldPulse (node: { p: string; d: 0 | 1 }, running?: Set<string>): boolean {
  return node.d === 0 && !!running?.has(node.p)
}
