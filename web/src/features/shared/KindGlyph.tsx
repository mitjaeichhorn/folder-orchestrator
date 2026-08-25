import { ClaudeIcon, CLAUDE_TONE } from './ClaudeIcon'
import { GLYPH, TONE } from '../feed/event-view'
import { cn } from '@/lib/utils'

/** Claude-originated rows get the Claude mark; filesystem rows keep their glyph. */
export function KindGlyph ({ kind, className, pulse }: {
  kind: string
  className?: string
  pulse?: boolean
}) {
  if (kind === 'tool' || kind === 'prompt') {
    return <ClaudeIcon className={cn('size-4', CLAUDE_TONE, pulse && 'orch-pulse', className)} />
  }
  return <span className={cn(TONE[kind], pulse && 'orch-pulse', className)}>{GLYPH[kind]}</span>
}
