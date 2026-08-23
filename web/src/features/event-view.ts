import type { OrchEvent } from '@/lib/api'
import { t } from '@/i18n'

export const GLYPH: Record<string, string> = {
  created: '✚', modified: '✎', deleted: '✖', renamed: '↻', tool: '⌘', prompt: '▸', alert: '⚠'
}
export const TONE: Record<string, string> = {
  created: 'text-emerald-400', modified: 'text-sky-400', deleted: 'text-rose-400',
  renamed: 'text-amber-400', tool: 'text-violet-400', prompt: 'text-muted-foreground',
  alert: 'text-orange-400'
}

export const oneLine = (s: string) => {
  const first = String(s).split('\n').find(l => l.trim()) ?? ''
  return first.length > 140 ? first.slice(0, 140) + '…' : first
}

/** One line, always. A row the operator has to unwrap is a row they skip. */
export function rowText (e: OrchEvent): string {
  if (e.detail?.collapsed) return t('feed.collapsed', { n: e.detail.collapsed })
  if (e.kind === 'alert') return t(e.detail?.label ?? 'kind.alert')
  if (e.kind === 'prompt') return oneLine(e.detail?.text ?? '')
  if (e.kind === 'tool') {
    if (e.path) return e.path
    const d = e.detail?.input
    // Claude Code's Bash tool carries its own description — a written summary,
    // no inference needed. Fall back to the command's first line.
    return oneLine(d?.description || d?.command || '')
  }
  if (e.kind === 'renamed' && e.detail?.oldPath) return `${e.path}  ←  ${e.detail.oldPath}`
  return e.path ?? ''
}
