import type { OrchEvent } from '@/lib/api'

export interface Burst { count: number; dir: string; paths: string[] }
export type CollapsedEvent = OrchEvent & { repeat?: number; burst?: Burst }

export const COLLAPSE_WINDOW = 2000

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
      out.push({
        ...e,
        burst: {
          count: members.reduce((n, m) => n + (rows[m].repeat ?? 1), 0),
          dir: dirOf(e.path as string),
          paths: members.map(m => rows[m].path as string)
        }
      })
    } else {
      out.push(e)
    }
  }
  return out
}
