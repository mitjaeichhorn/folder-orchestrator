/**
 * Telling concurrent agents apart in one feed.
 *
 * Several Claude Code sessions can work in the same repository at once —
 * measured here: three on this project inside one hour. Every tool event
 * carries its `session_id`, but nothing showed it, so three agents' work read
 * as one stream.
 *
 * **Colour is assigned by stable order, not by hashing the id.** A hash can put
 * two of three sessions in the same colour, which is exactly the failure the
 * chip exists to prevent; sorting and indexing cannot collide until the palette
 * runs out. Sorting also keeps the assignment stable across reloads for a fixed
 * set of sessions.
 *
 * The palette deliberately avoids every hue already carrying meaning: heat is
 * white -> yellow -> orange -> grey, churn is sky -> violet -> rose, locate is
 * blue-400, tool names are violet, and lines-added is emerald. Two signals in
 * one colour read as one signal.
 */

/** Hues reserved for session identity. Nothing else in the UI uses these. */
export const SESSION_TONES = [
  'text-teal-300',
  'text-fuchsia-300',
  'text-cyan-300',
  'text-pink-300',
  'text-lime-200'
] as const

/** Short enough to scan, long enough not to collide in practice. */
export const shortSession = (id: string | null | undefined): string =>
  typeof id === 'string' && id ? id.slice(0, 4) : ''

/**
 * Map every session present to a tone, assigned in sorted order.
 *
 * Beyond the palette length the tones repeat — with a note rather than a silent
 * wrap, because two agents sharing a colour is the one thing this must not do
 * quietly. In practice a repository has two or three concurrent sessions.
 */
export function sessionTones (ids: Iterable<string>): Map<string, string> {
  const sorted = [...new Set([...ids].filter(Boolean))].sort()
  const out = new Map<string, string>()
  sorted.forEach((id, i) => out.set(id, SESSION_TONES[i % SESSION_TONES.length]))
  return out
}

/** Distinct session ids in an event list, newest activity first. */
export function sessionsIn (events: Array<{ sessionId?: string | null; ts: number }>): string[] {
  const last = new Map<string, number>()
  for (const e of events) {
    if (!e.sessionId) continue
    const seen = last.get(e.sessionId)
    if (seen === undefined || e.ts > seen) last.set(e.sessionId, e.ts)
  }
  return [...last.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

/** True when more than one agent is present — the only time the chip earns space. */
export const isMultiSession = (ids: string[]): boolean => ids.length > 1

/**
 * What the row's pill says: Claude Code's name for the session, or the short id
 * until it has chosen one.
 *
 * The pill replaced a bare "claude"/"during" label. That label was nearly free
 * of information — a tool row is Claude by definition — while *which* of several
 * agents did it was not shown anywhere. The attribution strength it used to
 * carry moves to the pill's form: solid for a hard path join, outline for mere
 * co-occurrence.
 */
export function sessionLabel (name: string | undefined, id: string | null | undefined): string {
  const n = (name ?? '').trim()
  if (n) return n
  const short = shortSession(id)
  return short || ''
}
