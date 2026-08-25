import { isExecutablePath, LINE_ALERT_AT } from '../../../../shared/glob.js'

/**
 * Conditions worth the operator's attention, derived from events already on
 * screen. Deterministic and path-based — no model, same as everything else here.
 *
 * Every threshold below came from measuring this data, and several rules that
 * looked obvious were DELETED after measuring rather than tuned:
 *
 * - "tokens spent with no files written" fired on topics with zero events at
 *   all; token usage is read from the whole transcript while events are only
 *   this folder, so it measured bookkeeping, not distress.
 * - "many tool calls with no file change", as a RETROSPECTIVE rule, fired 41
 *   times and resolved 41 times, the longest after 60 minutes. It is the normal
 *   working rhythm. But that measurement could not have found a counterexample:
 *   an unresolved stretch is by definition still open, so it is never in the
 *   history. `stalled` is the same condition asked in the present tense — calls
 *   still landing, nothing written for a long time — and it is the one rule here
 *   that means "look now" rather than "this code has a problem".
 * - "consecutive failing calls" — 0 of 76 errors were retried with identical
 *   input; the agent adapted every time.
 *
 * What survived is mostly not "the agent is stuck". It is structural strain:
 * files too long, files two agents fight over, code outrunning its tests. The
 * copy says so, because an alert that reads as a verdict when 41 of 41 cases
 * were fine will teach the operator to ignore alerts.
 */

export type AlertKind = 'churn' | 'collision' | 'stalled'

export interface AlertEvidence {
  count?: number
  minutes?: number
  lines?: number
  sessions?: string[]
  seconds?: number
}

export interface Alert {
  /** Stable across re-detections of the same condition on the same file. */
  key: string
  kind: AlertKind
  path: string
  /** The newest event this alert is about — the row it hangs under. */
  anchorId: number
  anchorTs: number
  evidence: AlertEvidence
}

/** Measured: server.py hit 22 rewrites in 10 minutes; logs hit 166 and are excluded. */
export const CHURN_MIN = 8
export const CHURN_WINDOW_MS = 10 * 60_000
/** Two sessions this close on one file is a collision rather than a handover. */
export const COLLISION_WINDOW_MS = 5 * 60_000
/**
 * Stalled: still calling, nothing landing.
 *
 * Three conditions, and each removes a different false positive. Measured
 * across three watched projects at one moment: one had written 0.5 min ago
 * (working), one had not written for 99 minutes but had not called in 99 either
 * (idle, not stuck), and one had calls landing that second with no write for 16
 * minutes — the only one worth interrupting.
 *
 * The third condition came from replaying real history: without it the rule
 * reported 759- and 614-minute "stalls", which were mornings. Work resumes with
 * a few Bash calls before anything is written, so "no write since yesterday,
 * calls landing now" is true and useless. Requiring the calls to SPAN a stretch
 * means the agent has been working a while with nothing to show, which is the
 * actual claim.
 */
export const STALL_MS = 10 * 60_000
export const STALL_ACTIVE_MS = 5 * 60_000
export const STALL_CALL_SPAN_MS = 5 * 60_000

interface Ev {
  id?: number
  ts: number
  kind?: string
  path?: string | null
  tool?: string | null
  sessionId?: string | null
  detail?: Record<string, any>
}

const isWrite = (e: Ev) => !!e.path && (e.kind === 'modified' || e.kind === 'created')

/**
 * All conditions currently true, newest anchor first.
 *
 * `lines` is the path -> line count map the rest of the UI already uses; a rule
 * that needs it simply does not fire for files we never measured, rather than
 * assuming a length.
 */
export function detectAlerts (events: Ev[], lines?: Map<string, number>, now = Date.now()): Alert[] {
  const asc = [...events].sort((a, b) => a.ts - b.ts || (a.id ?? 0) - (b.id ?? 0))
  const out: Alert[] = []

  // --- churn: one executable file rewritten again and again -----------------
  const writes = new Map<string, Ev[]>()
  for (const e of asc) {
    if (!isWrite(e) || !isExecutablePath(e.path)) continue
    const list = writes.get(e.path as string) ?? []
    list.push(e)
    writes.set(e.path as string, list)
  }
  for (const [path, list] of writes) {
    // newest window only: the alert is about now, not about every past burst
    const last = list[list.length - 1]
    const inWindow = list.filter(e => last.ts - e.ts <= CHURN_WINDOW_MS)
    if (inWindow.length < CHURN_MIN) continue
    out.push({
      key: `churn:${path}`,
      kind: 'churn',
      path,
      anchorId: last.id ?? 0,
      anchorTs: last.ts,
      evidence: {
        count: inWindow.length,
        minutes: Math.max(1, Math.round((last.ts - inWindow[0].ts) / 60_000)),
        lines: lines?.get(path)
      }
    })
  }

  // --- collision: two sessions on one LONG file -----------------------------
  for (const [path, list] of writes) {
    const n = lines?.get(path)
    if (typeof n !== 'number' || n <= LINE_ALERT_AT) continue      // structural only
    let hit: { a: Ev; b: Ev } | null = null
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]; const b = list[i]
      if (a.sessionId && b.sessionId && a.sessionId !== b.sessionId &&
          b.ts - a.ts <= COLLISION_WINDOW_MS) hit = { a, b }
    }
    if (!hit) continue
    out.push({
      key: `collision:${path}`,
      kind: 'collision',
      path,
      anchorId: hit.b.id ?? 0,
      anchorTs: hit.b.ts,
      evidence: {
        lines: n,
        seconds: Math.max(1, Math.round((hit.b.ts - hit.a.ts) / 1000)),
        sessions: [hit.a.sessionId as string, hit.b.sessionId as string]
      }
    })
  }

  // --- stalled: calls still landing, nothing written -----------------------
  const lastWrite = [...asc].reverse().find(isWrite)
  const lastCall = [...asc].reverse().find(e => e.kind === 'tool')
  // The CURRENT unbroken run of calls: walk back until a gap longer than
  // STALL_ACTIVE_MS. Measuring from the last write instead spans the night —
  // the calls right after yesterday's final write are still "since" it, which
  // is how the rule came to report 602-minute stalls that were mornings.
  const callsSince = lastWrite ? asc.filter(e => e.kind === 'tool' && e.ts > lastWrite.ts) : []
  const run: Ev[] = []
  for (let i = callsSince.length - 1; i >= 0; i--) {
    const next = run.length ? run[0].ts : now
    if (next - callsSince[i].ts > STALL_ACTIVE_MS) break
    run.unshift(callsSince[i])
  }
  const callSpan = run.length ? run[run.length - 1].ts - run[0].ts : 0
  if (lastWrite && lastCall &&
      now - lastWrite.ts >= STALL_MS &&
      now - lastCall.ts <= STALL_ACTIVE_MS &&
      callSpan >= STALL_CALL_SPAN_MS) {
    out.push({
      key: `stalled:${lastWrite.path}`,
      kind: 'stalled',
      path: lastWrite.path as string,
      anchorId: lastWrite.id ?? 0,
      anchorTs: lastWrite.ts,
      evidence: {
        // How long the agent has been WORKING with nothing to show, not how
        // long since the last write. Those differ across a break: replaying
        // history, since-last-write reported 602- and 614-minute stalls that
        // were mornings, where the honest number was the 6 minutes of calls.
        minutes: Math.max(1, Math.round(callSpan / 60_000)),
        count: run.length
      }
    })
  }

  return out.sort((a, b) => b.anchorTs - a.anchorTs)
}

/**
 * Which alerts to show, given what has been dismissed.
 *
 * "Until it happens again" stores the anchor it was dismissed at, so the alert
 * returns only when a NEWER event re-triggers it. Storing a timestamp instead
 * would let a still-churning file re-alert every refresh, which is what the
 * dismissal exists to stop.
 */
export function visibleAlerts (
  alerts: Alert[],
  snoozed: Map<string, number>,
  muted: ReadonlySet<string>
): Alert[] {
  return alerts.filter(a => {
    if (muted.has(a.key)) return false
    const at = snoozed.get(a.key)
    return at === undefined || a.anchorId > at
  })
}

/**
 * Alerts grouped by the file they concern.
 *
 * Keyed on PATH, not on the anchor event id. The feed renders collapsed rows —
 * `collapseRepeats` merges consecutive writes to one file — so a churned file's
 * anchor event is precisely the one most likely to have been merged away and
 * never rendered. Every view already knows each row's path, and "under the last
 * affected file" is what the band is for.
 */
export function alertsByPath (alerts: Alert[]): Map<string, Alert[]> {
  const m = new Map<string, Alert[]>()
  for (const a of alerts) {
    const list = m.get(a.path) ?? []
    list.push(a)
    m.set(a.path, list)
  }
  return m
}
