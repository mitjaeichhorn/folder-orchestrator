/**
 * Heat is measured in EVENTS AGO, never in seconds.
 *
 * Each incoming event advances a tick and stamps the touched path — and every
 * ancestor folder — with it. Everything else keeps its old stamp, so its
 * distance from `now` grows and it visibly dims.
 *
 * The consequence is the point: dimming never happens on its own. A branch goes
 * dark only because other branches changed. A project sitting idle overnight
 * looks exactly as it did when work stopped — nothing decays while nothing
 * happens, so brightness always answers "what is being worked on", not "how
 * long ago was this".
 */
export const HEAT_SPAN = 40   // events until a branch reaches the floor
export const MIN_HEAT = 0.06  // never fully invisible — the tree must stay readable

export interface HeatState {
  tick: number
  stamps: Map<string, number>
}

export const emptyHeat = (): HeatState => ({ tick: 0, stamps: new Map() })

/** Every ancestor of `a/b/c.ts`: ['a', 'a/b', 'a/b/c.ts'] — closed folders light up too. */
export function ancestors (path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) out.push(parts.slice(0, i + 1).join('/'))
  return out
}

/** Advance one tick and stamp the path and its ancestors. Returns a NEW state. */
export function touch (state: HeatState, path: string | null | undefined): HeatState {
  if (!path) return state
  const tick = state.tick + 1
  const stamps = new Map(state.stamps)
  for (const p of ancestors(path)) stamps.set(p, tick)
  return { tick, stamps }
}

/** Apply many events in order — used for the initial backfill. */
export function touchAll (state: HeatState, paths: Array<string | null | undefined>): HeatState {
  let s = state
  for (const p of paths) s = touch(s, p)
  return s
}

/**
 * 1 = just changed, MIN_HEAT = untouched for HEAT_SPAN events or never touched.
 * A path with no stamp sits at the floor rather than being hidden.
 */
export function heatOf (state: HeatState, path: string): number {
  const stamp = state.stamps.get(path)
  if (stamp === undefined) return MIN_HEAT
  const age = state.tick - stamp
  if (age <= 0) return 1
  if (age >= HEAT_SPAN) return MIN_HEAT
  return Math.max(MIN_HEAT, 1 - age / HEAT_SPAN)
}

/** The tick at which a path was last touched, or null if never. */
export const stampOf = (state: HeatState, path: string): number | null =>
  state.stamps.get(path) ?? null

/**
 * True only for the paths touched by the most recent event — the file and every
 * folder above it. Drives the flash; everything else is unchanged this frame.
 */
export const justChanged = (state: HeatState, path: string): boolean =>
  state.tick > 0 && state.stamps.get(path) === state.tick

/** Keep the map bounded — a long session must not grow it without limit. */
export function prune (state: HeatState, keep = 4000): HeatState {
  if (state.stamps.size <= keep) return state
  const sorted = [...state.stamps.entries()].sort((a, b) => b[1] - a[1]).slice(0, keep)
  return { tick: state.tick, stamps: new Map(sorted) }
}
// heat
