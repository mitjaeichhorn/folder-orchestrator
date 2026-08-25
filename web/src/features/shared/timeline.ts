/**
 * Row height carries elapsed time: a row is taller when more time passed since
 * the event below it. The dashed rule under the timestamp is that duration made
 * visible, so a burst of work looks dense and a pause looks like a pause.
 */
export const PX_PER_SECOND = 3
export const MIN_GAP_PX = 0
export const MAX_GAP_PX = 180          // ponytail: hard cap. A 2h pause is not 21,600px.
export const CAP_SECONDS = MAX_GAP_PX / PX_PER_SECOND   // 60s

/** Pixels of dash to draw for a gap. Always finite, always within the cap. */
export function gapPx (deltaMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return MIN_GAP_PX
  return Math.min(MAX_GAP_PX, Math.round((deltaMs / 1000) * PX_PER_SECOND))
}

/** True when the real gap is longer than the cap can show — the UI must say so. */
export const isCapped = (deltaMs: number) =>
  Number.isFinite(deltaMs) && deltaMs / 1000 > CAP_SECONDS

/** Compact duration label. Character formatting only — no locale words. */
export function fmtGap (deltaMs: number): string {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return ''
  const s = Math.round(deltaMs / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`
}

/**
 * Gaps for a newest-first list: gaps[i] is the time between rows[i+1] (older)
 * and rows[i]. The last row has no predecessor in view, so its gap is 0.
 */
export function gaps (tsNewestFirst: number[]): number[] {
  return tsNewestFirst.map((ts, i) =>
    i + 1 < tsNewestFirst.length ? Math.max(0, ts - tsNewestFirst[i + 1]) : 0)
}

/**
 * A tool call is written to the transcript when it STARTS, so a row can be shown
 * while the work is still happening. `state` closes it when the result lands.
 */
export const isRunning = (e: { kind?: string; detail?: any }) =>
  e?.kind === 'tool' && e?.detail?.state === 'running'

/** How long a running call has been going, live. Capped so a stuck call is bounded. */
export const RUNNING_CAP_MS = 10 * 60 * 1000

export function runningFor (startTs: number, now: number): number {
  return Math.min(RUNNING_CAP_MS, Math.max(0, now - startTs))
}

/** True once a running call has passed the cap — the UI should stop pretending. */
export const isStalled = (startTs: number, now: number) => now - startTs > RUNNING_CAP_MS

type MinEvent = { kind?: string; path?: string | null; ts?: number; detail?: any }

/** When the oldest still-running tool call started, or null if nothing is running. */
export function runningSince (events: MinEvent[], now = Date.now()): number | null {
  let earliest: number | null = null
  for (const e of events) {
    if (!isRunning(e) || typeof e.ts !== 'number') continue
    // a call "running" for longer than the cap is stalled, not live; counting it
    // would drag the work-in-progress window back hours and pulse everything
    if (isStalled(e.ts, now)) continue
    if (earliest === null || e.ts < earliest) earliest = e.ts
  }
  return earliest
}

/**
 * Files to mark as "being worked on right now". Two sources, both factual:
 *
 *  1. A path an in-flight tool call named outright (Edit, Write, Read).
 *  2. A file the watcher saw change while a tool call was in flight.
 *
 * The second exists because the first is almost never visible: the tools that
 * name a file finish in milliseconds, while the long ones — Bash, MCP — name no
 * file at all. So a build writing fifty files would otherwise pulse nothing.
 *
 * Note what (2) claims: the change happened DURING a running command, not that
 * the command caused it. Co-occurrence, not causation — the same reason the
 * attribution join refuses to label an event `claude` without a path match.
 */
export function runningPaths (events: MinEvent[], now = Date.now()): Set<string> {
  const out = new Set<string>()
  const since = runningSince(events, now)
  for (const e of events) {
    if (isRunning(e) && e.path && !isStalled(e.ts ?? now, now)) out.add(e.path)
    if (since !== null && e.path && typeof e.ts === 'number' && e.ts >= since &&
        e.kind !== 'tool' && e.kind !== 'prompt' && e.kind !== 'alert') {
      out.add(e.path)
    }
  }
  return out
}
