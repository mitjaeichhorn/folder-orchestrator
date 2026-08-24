import type { OrchEvent } from '@/lib/api'

export const NO_FILE = '__nofile'
export const NO_TOPIC = '__notopic'

export interface FileGroup {
  path: string            // NO_FILE for actions that name no file
  events: OrchEvent[]     // newest first
  lastTs: number
  changes: number         // filesystem events
  claudeActions: number   // tool calls that named this file
  actors: Set<string>
}

export interface TopicGroup {
  topic: string           // the operator's prompt, verbatim; NO_TOPIC if unknown
  files: FileGroup[]
  lastTs: number
  events: number
  claudeActions: number
}

/**
 * Group events under the file they belong to.
 *
 * Honesty rule: an event lands under a file ONLY when it names that file —
 * a filesystem event's own path, or a tool call whose input declared a
 * `file_path`. Bash and MCP calls declare no file, so they group under
 * NO_FILE rather than being guessed into whichever file changed nearby.
 * Inferring a parent from timing would produce confident wrong answers.
 */
export function groupByFile (events: OrchEvent[]): FileGroup[] {
  const map = new Map<string, FileGroup>()
  for (const e of events) {
    const key = e.path ?? NO_FILE
    let g = map.get(key)
    if (!g) {
      g = { path: key, events: [], lastTs: 0, changes: 0, claudeActions: 0, actors: new Set() }
      map.set(key, g)
    }
    g.events.push(e)
    if (e.ts > g.lastTs) g.lastTs = e.ts
    if (e.kind === 'tool' || e.kind === 'prompt') g.claudeActions++
    else g.changes++
    g.actors.add(e.actor)
  }
  for (const g of map.values()) g.events.sort((a, b) => b.ts - a.ts)
  return [...map.values()].sort((a, b) => {
    if (a.path === NO_FILE) return 1   // pathless actions sink to the bottom
    if (b.path === NO_FILE) return -1
    return b.lastTs - a.lastTs
  })
}

/**
 * topic → file → actions.
 *
 * The topic is the operator's own prompt, carried verbatim from the transcript.
 * Events with no topic (filesystem changes nobody claimed, activity from before
 * the first prompt was seen) group under NO_TOPIC — they are never folded into
 * a neighbouring topic just because they happened at the same moment.
 */
export function groupByTopic (events: OrchEvent[]): TopicGroup[] {
  const byTopic = new Map<string, OrchEvent[]>()
  for (const e of events) {
    const key = e.topic ?? NO_TOPIC
    if (!byTopic.has(key)) byTopic.set(key, [])
    byTopic.get(key)!.push(e)
  }
  const groups: TopicGroup[] = [...byTopic.entries()].map(([topic, evs]) => {
    const files = groupByFile(evs)
    return {
      topic,
      files,
      lastTs: Math.max(...evs.map(e => e.ts)),
      events: evs.length,
      claudeActions: evs.filter(e => e.kind === 'tool' || e.kind === 'prompt').length
    }
  })
  return groups.sort((a, b) => {
    if (a.topic === NO_TOPIC) return 1
    if (b.topic === NO_TOPIC) return -1
    return b.lastTs - a.lastTs
  })
}

/** A file whose changes are all `external` while Claude was active is worth flagging. */
export const touchedByClaude = (g: FileGroup) => g.actors.has('claude')

/**
 * The newest event per path — what the detail panel should open when a file is
 * picked out of the project tree rather than out of the feed.
 *
 * Compares `ts` (then `id`) instead of trusting array order. The stream arrives
 * oldest-first and the feed reverses it into newest-first, so a "first match
 * wins" rule would be correct for one caller and silently wrong for the other.
 *
 * Paths absent from the result have no event behind them: the tree lists every
 * file in the project, including ones this tool has never seen change.
 */
export function newestEventByPath (events: OrchEvent[]): Map<string, OrchEvent> {
  const out = new Map<string, OrchEvent>()
  for (const e of events) {
    if (!e.path) continue
    const cur = out.get(e.path)
    if (!cur || e.ts > cur.ts || (e.ts === cur.ts && (e.id ?? 0) > (cur.id ?? 0))) {
      out.set(e.path, e)
    }
  }
  return out
}
