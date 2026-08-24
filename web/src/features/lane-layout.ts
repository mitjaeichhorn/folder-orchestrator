import { laneOf, LANES, type Lane } from './lanes.ts'

/**
 * Turning a chronological event list into rows of tiles.
 *
 * Two shapes come out, and they are not variants of each other:
 *
 * - a SPINE row, for an event with no file — `Bash`, MCP, a prompt. It spans
 *   every lane, because it is the shared clock the columns are read against and
 *   about half of all events land here.
 * - a TILE row, holding up to one tile per lane, for events that name a file.
 *
 * Events sharing an exact millisecond share a row, which is not a rounding
 * convenience: the watcher stamps `ts` when its 50ms debounce FLUSHES, so paths
 * changed by one operation are written with one identical timestamp. Same
 * millisecond means one action, so two files in the same lane at the same `ts`
 * collapse into a single tile carrying a count rather than pretending to be
 * separate events 0ms apart.
 *
 * Input must be OLDEST FIRST. The view reads downward into the present, so new
 * work arrives at the bottom and pushes everything up.
 */

export interface LaneTile {
  ev: LaneEvent
  /** Extra files in the same lane at the same instant, folded into this tile. */
  count: number
  paths: string[]
  /** Since the previous tile IN THIS LANE, or null when it is the lane's first. */
  gapMs: number | null
}

export interface LaneRow {
  ts: number
  /** Present on a spine row; the cells are empty when it is. */
  spine: LaneEvent | null
  cells: Partial<Record<Lane, LaneTile>>
}

export interface LaneEvent {
  id?: number
  ts: number
  path?: string | null
  kind?: string
  tool?: string | null
  sessionId?: string | null
  detail?: Record<string, unknown>
}

export function laneRows (eventsAsc: LaneEvent[]): LaneRow[] {
  const rows: LaneRow[] = []
  const lastInLane: Partial<Record<Lane, number>> = {}

  let i = 0
  while (i < eventsAsc.length) {
    const ts = eventsAsc[i].ts
    const group: LaneEvent[] = []
    while (i < eventsAsc.length && eventsAsc[i].ts === ts) group.push(eventsAsc[i++])

    // pathless events each get their own full-width row: they are separate work
    // however close together, the same rule the feed applies to tool rows
    for (const ev of group) {
      if (laneOf(ev.path) === 'spine') rows.push({ ts, spine: ev, cells: {} })
    }

    const sided = group.filter(ev => laneOf(ev.path) !== 'spine')
    if (!sided.length) continue

    const cells: Partial<Record<Lane, LaneTile>> = {}
    for (const ev of sided) {
      const lane = laneOf(ev.path) as Lane
      const cur = cells[lane]
      if (cur) {
        // one operation touching several files in the same lane
        cur.count++
        cur.paths.push(ev.path as string)
        continue
      }
      const prev = lastInLane[lane]
      cells[lane] = {
        ev,
        count: 1,
        paths: [ev.path as string],
        gapMs: prev === undefined ? null : ts - prev
      }
    }
    for (const lane of LANES) if (cells[lane]) lastInLane[lane] = ts
    rows.push({ ts, spine: null, cells })
  }
  return rows
}

/**
 * How long each lane has been silent, for the open connector at the bottom.
 *
 * This is the number worth watching: Work landing tiles every few seconds while
 * Test climbs past ten minutes is an agent building without checking itself.
 * Null for a lane that has never produced anything — there is no elapsed time
 * since an event that never happened.
 */
export function openGaps (eventsAsc: LaneEvent[], now: number): Partial<Record<Lane, number>> {
  const last: Partial<Record<Lane, number>> = {}
  for (const ev of eventsAsc) {
    const lane = laneOf(ev.path)
    if (lane !== 'spine') last[lane as Lane] = ev.ts
  }
  const out: Partial<Record<Lane, number>> = {}
  for (const lane of LANES) {
    if (last[lane] !== undefined) out[lane] = Math.max(0, now - (last[lane] as number))
  }
  return out
}
