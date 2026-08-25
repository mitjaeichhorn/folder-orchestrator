import type { OrchEvent } from '@/lib/api'

export const RUNNING_WINDOW = 60_000

/** Heuristic, and labelled as one in the UI: we observe activity, not the process. */
export const isRunning = (lastAt: number, now = Date.now()) => now - lastAt < RUNNING_WINDOW

export const UNATTRIBUTED = '__unattributed'

export function groupBySession (events: OrchEvent[]): Map<string, OrchEvent[]> {
  const g = new Map<string, OrchEvent[]>()
  for (const e of events) {
    if (e.kind !== 'tool' && e.kind !== 'prompt') continue
    const key = e.sessionId ?? UNATTRIBUTED
    if (!g.has(key)) g.set(key, [])
    g.get(key)!.push(e)
  }
  return g
}

export function filesTouched (events: OrchEvent[]): string[] {
  return [...new Set(events.filter(e => e.path).map(e => e.path as string))]
}
