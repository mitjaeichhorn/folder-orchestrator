import type { Alert } from './alerts.ts'

/**
 * The words for an alert, and the prompt it offers to send.
 *
 * Kept apart from `alerts.ts` so detection stays free of i18n and directly
 * testable, and apart from the components so the prompt can be asserted without
 * rendering anything. The prompt is SHOWN as well as copied: the operator
 * should be able to read what they are about to hand an agent.
 */

type T = (key: string, vars?: Record<string, string | number>) => string

/** Substitutions available to every string for a given alert. */
export function alertVars (a: Alert): Record<string, string | number> {
  // `n` is the number that rule leads with: writes for churn, LENGTH for
  // collision. Resolved here rather than giving each rule its own placeholders.
  const n = a.kind === 'collision' ? a.evidence.lines : (a.evidence.count ?? a.evidence.lines)
  return {
    path: a.path,
    n: n ?? 0,
    m: a.evidence.minutes ?? 0,
    s: a.evidence.seconds ?? 0
  }
}

export const alertTitle = (t: T, a: Alert) => t(`alert.${a.kind}.title`, alertVars(a))
export const alertBody = (t: T, a: Alert) => t(`alert.${a.kind}.body`, alertVars(a))
export const alertPrompt = (t: T, a: Alert) => t(`alert.${a.kind}.prompt`, alertVars(a))
