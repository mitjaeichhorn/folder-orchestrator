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
export function churnShare (changes: number, max: number): number {
  if (!Number.isFinite(changes) || changes <= 1 || max <= 1) return 0
  return Math.min(1, (changes - 1) / (max - 1))
}

export const CHURN_STOPS = [
  { at: 1.00, color: 'var(--color-rose-400)' },    // reworked most
  { at: 0.55, color: 'var(--color-violet-400)' },
  { at: 0.00, color: 'var(--color-sky-400)' }      // changed once
] as const

/** Interpolated in OKLab, like the heat ramp, so midpoints stay even. */
export function churnColor (share: number): string {
  const x = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0
  for (let i = 0; i < CHURN_STOPS.length - 1; i++) {
    const hot = CHURN_STOPS[i]
    const cold = CHURN_STOPS[i + 1]
    if (x <= hot.at && x >= cold.at) {
      const span = hot.at - cold.at
      const p = span === 0 ? 1 : (x - cold.at) / span
      if (p >= 0.999) return hot.color
      if (p <= 0.001) return cold.color
      return `color-mix(in oklab, ${hot.color} ${Math.round(p * 100)}%, ${cold.color})`
    }
  }
  return CHURN_STOPS[CHURN_STOPS.length - 1].color
}
