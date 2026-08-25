import { makeRamp, rampCss, shareOf } from '../shared/gradient.ts'
import type { FileGroup } from './group-by-file.ts'
import { NO_FILE } from './group-by-file.ts'

/**
 * The "By file" view: every file that changed, most recently changed first,
 * shaded by HOW OFTEN it changed.
 *
 * This is a different question from the heat tree, which shades by how *recently*
 * a path changed. Recency answers "what is being worked on now"; churn answers
 * "what keeps being reworked" — a file edited eleven times is telling you
 * something a file edited once is not. Because they mean different things they
 * use different hues, so the two panels can never be read as the same signal.
 */

/** Files only, newest change first. Pathless actions have nothing to rank. */
export function filesByLastChange (groups: FileGroup[]): FileGroup[] {
  return groups
    .filter(g => g.path !== NO_FILE && g.changes > 0)
    .sort((a, b) => b.lastTs - a.lastTs)
}

/** The busiest file in view — the scale everything else is measured against. */
export const maxChanges = (files: FileGroup[]): number =>
  files.reduce((m, f) => Math.max(m, f.changes), 0)

/**
 * Where a file sits between "changed once" and "changed most". Relative to the
 * current view rather than an absolute threshold: on a quiet folder three edits
 * is the busiest thing there is, and the ramp should still say so.
 */
export const churnShare = (changes: number, max: number) => shareOf(changes, max)

export const CHURN_STOPS = [
  { at: 1.00, color: 'var(--color-rose-400)' },    // reworked most
  { at: 0.55, color: 'var(--color-violet-400)' },
  { at: 0.00, color: 'var(--color-sky-400)' }      // changed once
] as const

/** Frequency ramp, same method as recency — see gradient.ts. */
export const churnColor = makeRamp(CHURN_STOPS)

export interface FileRow {
  path: string
  /** Last change: the newest of the filesystem mtime and anything we observed. */
  lastTs: number
  /** Changes this tool actually saw. Zero for a file that predates watching. */
  changes: number
  observed: boolean
  actors: Set<string>
  events: FileGroup['events']
  /** In the tree now. False for a file we watched being deleted. */
  present: boolean
  /** Line count, or undefined when the server declined to measure it. */
  lines?: number
}

/**
 * Every file in the project, ranked by when it last changed — not just the ones
 * we happened to observe.
 *
 * The filesystem's own mtime carries files that changed before watching started,
 * or while the tool was not running. Observed events add the change count on top.
 * A file we watched being deleted is no longer in the tree but still changed, so
 * it is kept and marked absent rather than silently dropped.
 */
export function allFilesByLastChange (
  treeFiles: Array<{ p: string; m?: number; l?: number }>,
  groups: FileGroup[]
): FileRow[] {
  const observed = new Map<string, FileGroup>()
  for (const g of groups) if (g.path !== NO_FILE) observed.set(g.path, g)

  const rows: FileRow[] = treeFiles.map(f => {
    const g = observed.get(f.p)
    observed.delete(f.p)
    return {
      path: f.p,
      lastTs: Math.max(f.m ?? 0, g?.lastTs ?? 0),
      changes: g?.changes ?? 0,
      observed: !!g && g.changes > 0,
      actors: g?.actors ?? new Set<string>(),
      events: g?.events ?? [],
      present: true,
      lines: f.l
    }
  })

  // whatever is left was observed but is not in the tree — deleted while watching
  for (const g of observed.values()) {
    if (g.changes === 0) continue
    rows.push({
      path: g.path, lastTs: g.lastTs, changes: g.changes,
      observed: true, actors: g.actors, events: g.events, present: false
    })
  }

  return rows.sort((a, b) => b.lastTs - a.lastTs)
}

/** Flatten a tree response into its files. */
interface TreeNodeLike { p: string; d: 0 | 1; m?: number; l?: number; c?: TreeNodeLike[] }

export function treeFiles (
  nodes: TreeNodeLike[] | undefined,
  out: Array<{ p: string; m?: number; l?: number }> = []
): Array<{ p: string; m?: number; l?: number }> {
  for (const n of nodes ?? []) {
    if (n.d === 0) out.push({ p: n.p, m: n.m, l: n.l })
    else treeFiles(n.c, out)
  }
  return out
}

/**
 * Which files gained a new event since the last render — the ones worth flashing.
 *
 * Compares the newest event id per path, not the count or timestamp: a count can
 * stay level while the newest event changes, and timestamps repeat within a
 * second. An empty previous map means first render, where nothing should flash —
 * otherwise the whole list would animate on arrival.
 */
export function changedPaths (
  prev: Map<string, number>, rows: Array<{ path: string; events: Array<{ id?: number }> }>
): { changed: string[]; next: Map<string, number> } {
  const next = new Map<string, number>()
  const changed: string[] = []
  const first = prev.size === 0
  for (const r of rows) {
    const id = r.events[0]?.id ?? 0
    next.set(r.path, id)
    if (first) continue
    const before = prev.get(r.path)
    if (before !== undefined && before !== id) changed.push(r.path)
    else if (before === undefined && id) changed.push(r.path)   // newly seen changing
  }
  return { changed, next }
}

/**
 * Paths whose most recent event was a deletion.
 *
 * Used to skip the thumbnail request for a file that is gone. The image would
 * 404 and collapse harmlessly, but it fills the console with failures that look
 * like bugs — and we already know the answer, so asking is wasted.
 *
 * `events` must be newest-first, as everywhere else.
 */
export function deletedPaths (events: Array<{ path?: string | null; kind?: string }>): Set<string> {
  const out = new Set<string>()
  const settled = new Set<string>()
  for (const e of events) {
    if (!e.path || settled.has(e.path)) continue
    if (e.kind === 'deleted') out.add(e.path)
    else if (e.kind === 'created' || e.kind === 'modified' || e.kind === 'renamed') settled.add(e.path)
  }
  return out
}

/** The churn ramp as a CSS gradient, for a legend. */
export const churnCss = () => rampCss(CHURN_STOPS)
