import type { OrchEvent } from '@/lib/api'

export interface Burst {
  count: number
  dir: string
  paths: string[]
  /** The call every member shares, or null when they disagree — see collapseBursts. */
  call: string | null
}
export type CollapsedEvent = OrchEvent & { repeat?: number; burst?: Burst }
export type NestedEvent = CollapsedEvent & { children?: CollapsedEvent[] }

export const COLLAPSE_WINDOW = 2000

/** Identity of a tool row, as referenced by a filesystem row's parent pointer. */
export const callKeyOf = (e: OrchEvent): string | null =>
  e.kind === 'tool' && e.id != null ? String(e.id) : null

/** Which call a filesystem row happened inside, or null if none/ambiguous. */
export const parentCallOf = (e: OrchEvent): string | null =>
  e.duringToolEventId != null ? String(e.duringToolEventId) : null

/**
 * A tool that writes a file then formats it produces two real events milliseconds
 * apart. Both are true, but at second-resolution they read as a duplicated row.
 *
 * Collapse consecutive rows with the same path, kind and actor inside a short
 * window into one, carrying a count — the data is never dropped, and the count
 * makes the repetition visible rather than hiding it.
 *
 * Tool calls are never collapsed: two Bash calls are two pieces of work, however
 * close together.
 *
 * `rows` must be newest-first; the kept row is the newest of each run.
 */
export function collapseRepeats (rows: OrchEvent[], windowMs = COLLAPSE_WINDOW): CollapsedEvent[] {
  const out: CollapsedEvent[] = []
  for (const e of rows) {
    const prev = out[out.length - 1]
    const collapsible = e.path != null && e.kind !== 'tool' && e.kind !== 'prompt' && e.kind !== 'alert'
    if (
      prev && collapsible &&
      prev.path === e.path && prev.kind === e.kind && prev.actor === e.actor &&
      // two identical adjacent changes from DIFFERENT calls are two pieces of
      // work; merging them would attribute both to whichever survived
      parentCallOf(prev) === parentCallOf(e) &&
      Math.abs(prev.ts - e.ts) <= windowMs
    ) {
      prev.repeat = (prev.repeat ?? 1) + 1
      continue
    }
    out.push({ ...e })
  }
  return out
}

// 5s, not 2: a build or a formatter writes its files over several seconds and
// is still one action. Wider than this starts merging genuinely separate work.
export const BURST_WINDOW = 5000
export const BURST_MIN = 3

export const dirOf = (path: string): string => {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

const burstable = (e: OrchEvent) =>
  e.path != null && e.kind !== 'tool' && e.kind !== 'prompt' && e.kind !== 'alert'

/**
 * One command deleting eight files produces eight true rows. They are not
 * duplicates — the paths differ — so the repeat collapse cannot touch them, yet
 * they read as noise for a single action.
 *
 * Group same kind + actor + parent directory inside a window into one row that
 * names the directory and the count, keeping every path for the detail panel.
 *
 * Grouping is by window, not by adjacency: an alert fired by the same burst sits
 * in the middle of the run, and must not split it in two. Rows stay in place —
 * the group takes the position of its newest member.
 *
 * `rows` must be newest-first.
 */
export function collapseBursts (
  rows: CollapsedEvent[], windowMs = BURST_WINDOW, minCount = BURST_MIN
): CollapsedEvent[] {
  const used = new Set<number>()
  const out: CollapsedEvent[] = []

  for (let i = 0; i < rows.length; i++) {
    if (used.has(i)) continue
    const e = rows[i]
    if (!burstable(e)) { out.push(e); continue }

    const key = `${e.kind}|${e.actor}|${dirOf(e.path as string)}`
    const members = [i]
    for (let j = i + 1; j < rows.length; j++) {
      const f = rows[j]
      // rows are time-ordered, so once outside the window nothing later can match
      if (Math.abs(e.ts - f.ts) > windowMs) break
      if (used.has(j) || !burstable(f)) continue
      if (`${f.kind}|${f.actor}|${dirOf(f.path as string)}` === key) members.push(j)
    }

    if (members.length >= minCount) {
      for (const m of members) used.add(m)
      // A burst stands for several events that may belong to different calls.
      // Nesting it on the strength of its newest member alone would drag the
      // others under a call that did not produce them, so a burst only carries a
      // call when every member agrees on one.
      const calls = new Set(members.map(m => parentCallOf(rows[m])))
      out.push({
        ...e,
        burst: {
          count: members.reduce((n, m) => n + (rows[m].repeat ?? 1), 0),
          dir: dirOf(e.path as string),
          paths: members.map(m => rows[m].path as string),
          call: calls.size === 1 ? [...calls][0] : null
        }
      })
    } else {
      out.push(e)
    }
  }
  return out
}

/**
 * Nest filesystem rows under the tool call whose measured interval contained them.
 *
 * Runs LAST, after both collapse passes: `collapseRepeats` needs adjacency and
 * `collapseBursts` needs a flat time-ordered window, so neither can be handed a
 * nested array. Running this first would also stop bursts forming across calls.
 *
 * A row is adopted only if its parent is present in this same array. That
 * condition is what keeps orphans visible — a change whose call was filtered out,
 * evicted, or falls outside the loaded window stays a top-level row rather than
 * disappearing.
 *
 * Ordering matters and is load-bearing: a tool call is written when it STARTS, so
 * its files have LARGER timestamps and sit ABOVE it in the newest-first list.
 * Nesting therefore only ever pulls rows downward, and never reorders what
 * remains — so the top-level array stays sorted newest-first and `gaps()` keeps
 * working unchanged. Do NOT hoist a call row to its newest child: that would put a
 * row at a `ts` greater than its neighbour above, `gaps()` would clamp the
 * negative delta to zero, and elapsed time would be silently destroyed.
 *
 * Depth is exactly 1 — a tool row is never adopted, so there is no recursion.
 */
export function nestByCall (rows: CollapsedEvent[]): NestedEvent[] {
  const parents = new Map<string, NestedEvent>()
  for (const e of rows) {
    const key = callKeyOf(e)
    if (key) parents.set(key, e as NestedEvent)
  }
  if (parents.size === 0) return rows as NestedEvent[]

  const out: NestedEvent[] = []
  for (const e of rows) {
    // a burst carries its own shared call; a plain row carries its own pointer
    const key = e.burst ? e.burst.call : parentCallOf(e)
    const adoptable = key != null && e.kind !== 'tool' && e.kind !== 'prompt' && e.kind !== 'alert'
    const parent = adoptable ? parents.get(key as string) : undefined
    if (parent && parent !== e) {
      ;(parent.children ??= []).push(e)
      continue
    }
    out.push(e)
  }
  return out
}

/** Rows the operator can actually see: top level plus every child. */
export const visibleCount = (rows: NestedEvent[]): number =>
  rows.reduce((n, r) => n + 1 + (r.children?.length ?? 0), 0)
