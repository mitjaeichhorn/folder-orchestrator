import { cn } from '@/lib/utils'

/**
 * The Claude Code mark (thesvg.org/icon/claude-code), inlined so it inherits
 * currentColor and costs no asset request. Brand colour is #D97757.
 * Replaces the ⌘ glyph, which meant "command key", not "Claude did this".
 */
export function ClaudeIcon ({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('size-4', className)}>
      <path
        clipRule="evenodd"
        fillRule="evenodd"
        fill="currentColor"
        d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"
      />
    </svg>
  )
}

/** Anthropic's brand terracotta — the mark is recognisable by colour too. */
export const CLAUDE_TONE = 'text-[#D97757]'
