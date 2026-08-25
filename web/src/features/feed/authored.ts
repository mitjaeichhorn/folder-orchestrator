import type { OrchEvent } from '@/lib/api'

/**
 * Neon green means "someone wrote this": your prompt (the topic), or the agent's
 * own description of a command. Distinct from paths, which are machine facts,
 * and from tool names, which are violet.
 *
 * Kept free of runtime imports so it stays directly testable.
 */
export const AUTHORED_TONE = 'text-lime-300'

/**
 * A tool's own description of what it is doing. Authored text, but it is the
 * bulk of the feed, so it reads as light grey body copy rather than competing
 * with the prompts. Lighter than the tool name beside it (zinc-400).
 */
export const TOOL_DESC_TONE = 'text-zinc-300'

/** Is this row's label authored text rather than a path or a machine value? */
export function isAuthored (e: OrchEvent): boolean {
  if (e.kind === 'prompt') return true
  if (e.kind !== 'tool') return false
  if (e.path) return false                      // a path is a fact, not a label
  return !!e.detail?.input?.description         // only the written description counts
}
