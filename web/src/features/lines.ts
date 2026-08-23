// Relative, not the `@shared` alias: that alias is a Vite resolution and this
// module must load under Node's type-stripping test runner too.
import { LINE_ALERT_AT, isBadgeExempt } from '../../../shared/glob.js'

/**
 * Whether a file is long enough to say so. One rule, every surface.
 *
 * The badge deliberately does NOT re-apply the python exemption. That exemption
 * decides which files a *filter* collects, and only By file has filters — the
 * feed, By topic and the detail panel have none, so exempting there meant the
 * badge showed nothing at all: measured live, all five long files present in the
 * feed were `.py`, and the panel for a 1,648-line `test_runner.py` was blank.
 * A rule that hides the answer everywhere it cannot be un-hidden is not a rule,
 * it is a bug.
 *
 * Kept out of `LineBadge.tsx` because Node's type-stripping runner cannot load
 * `.tsx` — so the shared rule lives where it can actually be asserted, rather
 * than being re-implemented in a test that would pass while the component drifted.
 */
export function showsLineBadge (lines?: number): boolean {
  return typeof lines === 'number' && lines > LINE_ALERT_AT
}

/** Files the default "over N lines" filter collects — python excluded. */
export function inDefaultLongFilter (path: string, lines?: number): boolean {
  return showsLineBadge(lines) && !isBadgeExempt(path)
}

/**
 * Flat tree files -> path lookup. Only files we actually measured appear, so a
 * missing key means "not judged" — an exempt extension, a binary, or a file over
 * the read cap — and never "short".
 */
export function lineIndex (files: Array<{ p: string; l?: number }> | null): Map<string, number> {
  const m = new Map<string, number>()
  for (const f of files ?? []) if (typeof f.l === 'number') m.set(f.p, f.l)
  return m
}
