import { makeRamp, rampCss } from '../shared/gradient.ts'

/**
 * Recency: just-edited is white, cooling through yellow and orange into the
 * muted grey the rest of the tree sits at. Built with the shared ramp method —
 * see gradient.ts for the rules every ramp here follows.
 */
export const HEAT_STOPS = [
  { at: 1.00, color: '#ffffff' },                        // just edited
  { at: 0.70, color: '#fde047' },                        // yellow-300
  { at: 0.40, color: '#fb923c' },                        // orange-400
  { at: 0.00, color: 'var(--color-muted-foreground)' }   // cold
] as const

export const heatColor = makeRamp(HEAT_STOPS)

/**
 * The bottom of the third grade — orange, the last band before the muted tail.
 *
 * Read off the stops rather than written as a number, so a change to the ramp
 * moves anything keyed to it. Used to decide what may pulse: only the top three
 * grades, white through orange.
 */
export const PULSE_FLOOR = HEAT_STOPS[HEAT_STOPS.length - 2].at

/**
 * Heat is carried by COLOUR ALONE — never element opacity.
 *
 * Opacity dims an element's background as well as its text, so a cold branch cut
 * the locate highlight from 12% to under 6% alpha: the reveal was faintest
 * exactly where it exists to help. The ramp already spans white to muted grey,
 * which is separation enough without also fading the element.
 */
export const heatStyle = (h: number) => ({ color: heatColor(h) })

/** The recency ramp as a CSS gradient, for a legend. */
export const heatCss = () => rampCss(HEAT_STOPS)
