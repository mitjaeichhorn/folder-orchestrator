/**
 * Heat ramp: just-edited is white, cooling through yellow and orange, then
 * fading into the muted grey the rest of the tree sits at.
 *
 * Stops are ordered hottest-first and interpolated in OKLab, so the midpoints
 * stay perceptually even instead of going muddy the way sRGB blending does.
 */
export const HEAT_STOPS = [
  { at: 1.00, color: '#ffffff' },                        // just edited
  { at: 0.70, color: '#fde047' },                        // yellow-300
  { at: 0.40, color: '#fb923c' },                        // orange-400
  { at: 0.00, color: 'var(--color-muted-foreground)' }   // cold
] as const

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

export function heatColor (h: number): string {
  const x = clamp01(h)
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    const hot = HEAT_STOPS[i]
    const cold = HEAT_STOPS[i + 1]
    if (x <= hot.at && x >= cold.at) {
      const span = hot.at - cold.at
      const share = span === 0 ? 1 : (x - cold.at) / span
      if (share >= 0.999) return hot.color
      if (share <= 0.001) return cold.color
      return `color-mix(in oklab, ${hot.color} ${Math.round(share * 100)}%, ${cold.color})`
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1].color
}

/** Cold entries stay legible; hot ones sit at full strength. */
export const heatOpacity = (h: number) => 0.45 + clamp01(h) * 0.55
