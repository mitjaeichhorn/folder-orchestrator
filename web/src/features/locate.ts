import { ancestors } from './heat.ts'

/**
 * Hovering a feed row reveals that file in the heat tree — expanding collapsed
 * ancestors and overriding "Active only" so it is always visible.
 *
 * The override is applied at DERIVE time and never written to `closed` or
 * `activeOnly`. Restoring is therefore the absence of the override rather than an
 * undo step: there is no path where a restore can be missed, and no hazard if the
 * pointer leaves during a re-render or a tree refetch.
 */

/** Shared empty set so a no-hover render is referentially stable. */
const EMPTY: ReadonlySet<string> = Object.freeze(new Set<string>()) as ReadonlySet<string>

/** The file and every folder above it — the branch to reveal. */
export function chainOf (path: string | null | undefined): ReadonlySet<string> {
  if (!path) return EMPTY
  return new Set(ancestors(path))
}

/**
 * Widen an "is this branch active?" test so the hovered chain survives pruning.
 * With an empty chain this is behaviourally identical to the bare predicate, which
 * is what keeps "Active only" working exactly as before when nothing is hovered.
 */
export const revealPredicate =
  (isActive: (p: string) => boolean, chain: ReadonlySet<string>) =>
    (p: string): boolean => isActive(p) || chain.has(p)

/** A folder is open if it is not collapsed, or if the hovered chain runs through it. */
export const isOpenWith = (
  closed: ReadonlySet<string>, chain: ReadonlySet<string>, p: string
): boolean => !closed.has(p) || chain.has(p)
