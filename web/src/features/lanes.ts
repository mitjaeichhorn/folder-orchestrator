/**
 * Three lanes plus a spine.
 *
 * `planning` is what the agent wrote before it built anything, `work` is the
 * build, `test` is what proves it. The spine is everything with no file at all
 * — `Bash`, MCP calls, prompts — and it is not a leftover: measured on real
 * sessions it is 53% of events here and 45% on a larger project. A lane view
 * that treated the spine as an afterthought would hide half the session, which
 * is why it renders full width rather than in a fourth column.
 *
 * Classification is path-only and deterministic — the same machinery the ignore
 * rules use, no model involved. It is also the first thing in this app that
 * *interprets* rather than reports: "this file is planning" is a convention,
 * not an observation. The rules are therefore kept small, ordered, and visible
 * here rather than scattered, so a file landing in the wrong lane is a rule you
 * can read and change.
 *
 * Order matters. `test` is checked before `planning` so a test fixture named
 * `.md` does not read as a plan, and before `work` because a test IS work by
 * any other measure — the split only earns its place if the tests separate out.
 */

export type Lane = 'planning' | 'work' | 'test' | 'spine'
export const LANES: readonly Lane[] = ['planning', 'work', 'test'] as const

/** A test: by directory, by filename convention, or by pytest's conftest. */
const TEST_RE = /\.test\.|\.spec\.|(^|\/)__tests__\/|(^|\/)tests?\/|(^|\/)conftest\./i

/** Written for humans to read: plans, epics, specs, docs. */
const PLANNING_RE = /(^|\/)(__plan|__documentation|docs?|plans?|specs?)\/|\.(md|markdown|mdown|mkd)$/i

export function laneOf (path: string | null | undefined): Lane {
  if (!path) return 'spine'
  if (TEST_RE.test(path)) return 'test'
  if (PLANNING_RE.test(path)) return 'planning'
  return 'work'
}

/** Tone per lane. Distinct from heat, churn, locate and the session palette. */
export const LANE_TONE: Record<Lane, string> = {
  planning: 'text-amber-300',
  work: 'text-slate-200',
  test: 'text-emerald-300',
  spine: 'text-muted-foreground'
}

/**
 * How much of a session sits in each lane.
 *
 * The reason this view exists: measured across four concurrent agents, one was
 * 76% planning, another 54% work, another 100% spine — they specialise, and a
 * session spread evenly across everything is usually one that has lost the plot.
 */
export function laneProfile (events: Array<{ path?: string | null }>): Record<Lane, number> {
  const out: Record<Lane, number> = { planning: 0, work: 0, test: 0, spine: 0 }
  for (const e of events) out[laneOf(e.path)]++
  return out
}
