import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { matchEvent, ALL_KINDS } from '@shared/glob.js'
import type { OrchEvent } from '@/lib/api'
import { t, fmtTime } from '@/i18n'
import { cn } from '@/lib/utils'

const GLYPH: Record<string, string> = {
  created: '✚', modified: '✎', deleted: '✖', renamed: '↻', tool: '⌘', prompt: '▸', alert: '⚠'
}
const TONE: Record<string, string> = {
  created: 'text-emerald-400', modified: 'text-sky-400', deleted: 'text-rose-400',
  renamed: 'text-amber-400', tool: 'text-violet-400', prompt: 'text-muted-foreground', alert: 'text-orange-400'
}
const WINDOWS = [
  { key: 'window.15m', ms: 15 * 60_000 },
  { key: 'window.1h', ms: 60 * 60_000 },
  { key: 'window.24h', ms: 24 * 3600_000 },
  { key: 'window.all', ms: 0 }
]

/** One line, always. A row the operator has to unwrap is a row they skip. */
function rowText (e: OrchEvent): string {
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

const oneLine = (s: string) => {
  const first = String(s).split('\n').find(l => l.trim()) ?? ''
  return first.length > 140 ? first.slice(0, 140) + '…' : first
}

export function Feed ({ events, evicted, selected, onSelect }: {
  events: OrchEvent[]
  evicted: number
  selected: OrchEvent | null
  onSelect: (e: OrchEvent) => void
}) {
  const [kinds, setKinds] = useState<string[]>([])
  const [pathGlob, setPathGlob] = useState('')
  const [windowMs, setWindowMs] = useState(0)
  const [pinned, setPinned] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)

  const filter = useMemo(() => ({
    kinds: kinds.length ? kinds : undefined,
    pathGlob: pathGlob.trim() || undefined,
    since: windowMs ? Date.now() - windowMs : undefined
  }), [kinds, pathGlob, windowMs])

  // the ONE predicate — same module the server uses
  const rows = useMemo(
    () => events.filter(e => matchEvent(e, filter)).slice().reverse(),
    [events, filter]
  )

  const lastCount = useRef(rows.length)
  useEffect(() => {
    const grew = rows.length - lastCount.current
    lastCount.current = rows.length
    if (grew <= 0) return
    if (pinned) viewport.current?.scrollTo({ top: 0 })
    else setUnseen(n => n + grew)
  }, [rows.length, pinned])

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const atTop = e.currentTarget.scrollTop <= 4
    setPinned(atTop)
    if (atTop) setUnseen(0)
  }

  const jumpToLatest = () => {
    viewport.current?.scrollTo({ top: 0, behavior: 'smooth' })
    setPinned(true); setUnseen(0)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <ToggleGroup multiple size="sm" variant="outline" value={kinds} onValueChange={v => setKinds(v as string[])}>
          {ALL_KINDS.map((k: string) => (
            <ToggleGroupItem key={k} value={k} aria-label={t(`kind.${k}`)}>
              <span className={cn('mr-1', TONE[k])}>{GLYPH[k]}</span>{t(`kind.${k}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Input className="h-8 w-56" value={pathGlob} placeholder={t('feed.filterPath')}
          onChange={e => setPathGlob(e.target.value)} />
        <Select value={String(windowMs)} onValueChange={v => setWindowMs(Number(v))}>
          <SelectTrigger className="h-8 w-36">
            <SelectValue>
              {() => t(WINDOWS.find(w => w.ms === windowMs)?.key ?? 'feed.window')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {WINDOWS.map(w => <SelectItem key={w.key} value={String(w.ms)}>{t(w.key)}</SelectItem>)}
          </SelectContent>
        </Select>
        {!pinned && unseen > 0 && (
          <Button size="sm" variant="secondary" onClick={jumpToLatest}>{t('feed.newEvents', { n: unseen })}</Button>
        )}
      </div>

      <div ref={viewport} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0
          ? <p className="text-muted-foreground p-8 text-center text-sm">
              {events.length === 0 ? t('feed.empty') : t('feed.emptyFiltered')}
            </p>
          : (
            <table className="w-full table-fixed text-sm">
              <tbody>
                {rows.map(e => (
                  <tr key={e.id ?? `${e.ts}-${e.path}`}
                    onClick={() => onSelect(e)}
                    className={cn('hover:bg-muted/50 cursor-pointer border-b',
                      selected?.id === e.id && 'bg-muted')}>
                    <td className="text-muted-foreground w-20 px-3 py-1 align-top font-mono text-xs tabular-nums">
                      {fmtTime(e.ts)}
                    </td>
                    <td className={cn('w-6 py-1 align-top', TONE[e.kind])}>{GLYPH[e.kind]}</td>
                    <td className="w-20 py-1 align-top">
                      {e.tool && <span className="text-violet-400 font-mono text-xs">{e.tool}</span>}
                    </td>
                    <td className="max-w-0 py-1 pr-2 align-top">
                      <div className="truncate font-mono text-xs" title={rowText(e)}>{rowText(e)}</div>
                    </td>
                    <td className="w-16 py-1 pr-2 text-right align-top">
                      {e.actor === 'claude' && (
                        <Badge variant="secondary" className="text-violet-300">{t('actor.claude')}</Badge>
                      )}
                    </td>
                    <td className="text-muted-foreground w-16 py-1 pr-3 text-right align-top font-mono text-xs tabular-nums">
                      {typeof e.detail?.linesAdded === 'number' && (
                        <span className="text-emerald-400">{t('detail.linesAdded', { n: e.detail.linesAdded })}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        {evicted > 0 && (
          <p className="text-muted-foreground border-t p-3 text-center text-xs">{t('feed.olderInHistory')}</p>
        )}
      </div>
    </div>
  )
}
