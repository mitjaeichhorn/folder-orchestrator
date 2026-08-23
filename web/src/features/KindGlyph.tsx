import { ClaudeIcon, CLAUDE_TONE } from './ClaudeIcon'
import { GLYPH, TONE } from './event-view'
import { cn } from '@/lib/utils'

/** Claude-originated rows get the Claude mark; filesystem rows keep their glyph. */
export function KindGlyph ({ kind, className }: { kind: string; className?: string }) {
  if (kind === 'tool' || kind === 'prompt') {
    return <ClaudeIcon className={cn('size-4', CLAUDE_TONE, className)} />
  }
  return <span className={cn(TONE[kind], className)}>{GLYPH[kind]}</span>
}
