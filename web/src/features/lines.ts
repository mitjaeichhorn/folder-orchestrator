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

/**
 * Length tiers. Note these run hotter toward yellow, matching this app's own
 * heat ramp (white -> yellow -> orange -> grey) rather than the traffic-light
 * convention where orange outranks yellow.
 */
export const LINE_TIER_ORANGE = 2000
export const LINE_TIER_YELLOW = 3000

/**
 * The badge's colour for a given length. Discrete tiers, not a ramp: `gradient.ts`
 * exists for continuous scales, and interpolating here would put a different
 * colour on 2,001 and 2,002 lines — a distinction with no meaning. Three steps
 * say "long", "longer", "worst" and nothing finer.
 */
export function lineTone (lines: number): string {
  if (lines > LINE_TIER_YELLOW) return 'border-yellow-400/40 text-yellow-400'
  if (lines > LINE_TIER_ORANGE) return 'border-orange-400/40 text-orange-400'
  return 'text-muted-foreground'
}

/**
 * The same three tiers for a bare GLYPH, with the floor lifted off muted.
 *
 * `lineTone` was designed for a pill that carries the number, where the base
 * tier can afford to be quiet because the text still reads. A 10px triangle at
 * `text-muted-foreground` is invisible against the tree — measured at
 * `oklch(0.708 0 0)`, flush to the panel edge — and the base tier is where most
 * flagged files live: 130 over 1,000 lines against far fewer over 2,000. An
 * alert nobody can see is not an alert, so the ranking is kept and the floor
 * moved to amber.
 */
export function lineIconTone (lines: number): string {
  if (lines > LINE_TIER_YELLOW) return 'text-yellow-400'
  if (lines > LINE_TIER_ORANGE) return 'text-orange-400'
  return 'text-amber-500'
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
