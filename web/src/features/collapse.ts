import type { OrchEvent } from '@/lib/api'

export type CollapsedEvent = OrchEvent & { repeat?: number }

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
