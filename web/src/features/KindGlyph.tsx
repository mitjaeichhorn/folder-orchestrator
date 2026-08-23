import { ClaudeIcon } from './ClaudeIcon'
import { GLYPH, TONE } from './event-view'
import { cn } from '@/lib/utils'

/** Claude-originated rows get the Claude mark; filesystem rows keep their glyph. */
export function KindGlyph ({ kind, className }: { kind: string; className?: string }) {
  if (kind === 'tool' || kind === 'prompt') {
    return <ClaudeIcon className={cn('size-3.5 text-violet-400', className)} />
  }
  return <span className={cn(TONE[kind], className)}>{GLYPH[kind]}</span>
}
