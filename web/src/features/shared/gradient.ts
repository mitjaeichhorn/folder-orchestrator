/**
 * The one way this app builds a colour ramp.
 *
 * Every gradient here follows the same method, so a new one is a list of stops
 * rather than a new piece of interpolation logic:
 *
 * 1. **Stops are ordered hot → cold**, each with `at` in 0..1 and a CSS colour.
 *    `at` is a position on the scale, not a data value: callers normalise their
 *    own units to 0..1 first, so the ramp never needs to know what it measures.
 * 2. **Interpolation is `color-mix(in oklab, …)`** — perceptually even, so the
 *    midpoint of a ramp looks like a midpoint instead of going muddy the way
 *    sRGB blending does.
 * 3. **The endpoints return their stop verbatim.** No `color-mix` wrapper at 0%
 *    or 100%, so "fully hot" is exactly the colour you declared.
 * 4. **Input is clamped, including non-finite.** A ramp never produces
 *    `color-mix(in oklab, X NaN%, Y)`, which renders as nothing.
 * 5. **Colour only, never opacity.** Element opacity also fades the background,
 *    which silently weakens anything layered on top — a highlight, a flash, a
 *    selection. Encode the signal in the colour and leave alpha alone.
 *
 * Two ramps must not share a hue family if they can appear at once: two signals
 * in the same colour read as one signal.
 */

export interface Stop { readonly at: number; readonly color: string }

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/** Build a ramp from stops ordered hot → cold. */
export function makeRamp (stops: readonly Stop[]) {
  return function ramp (share: number): string {
    const x = clamp01(share)
    for (let i = 0; i < stops.length - 1; i++) {
      const hot = stops[i]
      const cold = stops[i + 1]
      if (x <= hot.at && x >= cold.at) {
        const span = hot.at - cold.at
        const p = span === 0 ? 1 : (x - cold.at) / span
        if (p >= 0.999) return hot.color
        if (p <= 0.001) return cold.color
        return `color-mix(in oklab, ${hot.color} ${Math.round(p * 100)}%, ${cold.color})`
      }
    }
    return stops[stops.length - 1].color
  }
}

/** The same stops as a CSS gradient, for a legend. Cold on the left. */
export function rampCss (stops: readonly Stop[], direction = 'to right'): string {
  const parts = [...stops]
    .sort((a, b) => a.at - b.at)
    .map(s => `${s.color} ${Math.round(s.at * 100)}%`)
  return `linear-gradient(${direction}, ${parts.join(', ')})`
}

/**
 * Normalise a count to 0..1 against the largest in view.
 *
 * Relative rather than absolute on purpose: on a quiet folder three edits is the
 * busiest thing there is, and the ramp should say so. A value at or below the
 * floor returns 0 — the bottom of a ramp means "nothing to report", not "a
 * little".
 */
export function shareOf (value: number, max: number, floor = 1): number {
  if (!Number.isFinite(value) || value <= floor || max <= floor) return 0
  return Math.min(1, (value - floor) / (max - floor))
}
