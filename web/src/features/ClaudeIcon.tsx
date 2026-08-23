import { cn } from '@/lib/utils'

/**
 * Claude's radiating burst mark, drawn inline so it inherits currentColor and
 * needs no asset request. Replaces the ⌘ glyph, which meant "command key", not
 * "Claude did this".
 */
export function ClaudeIcon ({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"
      className={cn('size-3.5', className)}
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      {/* four long spokes */}
      <path d="M12 2.5v6.2M12 15.3v6.2M2.5 12h6.2M15.3 12h6.2" />
      {/* four short diagonals, half length, giving the mark its burst weight */}
      <path d="M5.9 5.9l3.1 3.1M15 15l3.1 3.1M18.1 5.9L15 9M9 15l-3.1 3.1"
        strokeWidth="1.7" opacity="0.85" />
    </svg>
  )
}
