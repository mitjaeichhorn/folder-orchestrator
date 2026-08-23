import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { matchEvent, ALL_KINDS, isImagePath } from '@shared/glob.js'
import { rowText } from './event-view'
import { isAuthored, AUTHORED_TONE } from './authored'
import { gaps, gapPx, fmtGap, isCapped, isRunning, runningFor, isStalled } from './timeline'
import { FilePath } from './FilePath'
import { Thumb } from './Thumb'
import { Lightbox } from './Lightbox'
import { ToolLabel } from './ToolLabel'
import { collapseRepeats, collapseBursts } from './collapse'
import { KindGlyph } from './KindGlyph'
import { Tree } from './Tree'
import type { OrchEvent } from '@/lib/api'
import { t, fmtTime } from '@/i18n'
import { cn } from '@/lib/utils'

const WINDOWS = [
  { key: 'window.15m', ms: 15 * 60_000 },
  { key: 'window.1h', ms: 60 * 60_000 },
  { key: 'window.24h', ms: 24 * 3600_000 },
  { key: 'window.all', ms: 0 }
]


export function Feed ({ events, evicted, selected, onSelect, folderId, filtersOpen = true, running }: {
  events: OrchEvent[]
  evicted: number
  selected: OrchEvent | null
  onSelect: (e: OrchEvent) => void
  folderId: string
  filtersOpen?: boolean
  running?: Set<string>
}) {
  const [kinds, setKinds] = useState<string[]>([])
  const [pathGlob, setPathGlob] = useState('')
  const [windowMs, setWindowMs] = useState(0)
  const [view, setView] = useState<'timeline' | 'tree'>('timeline')
  const [zoom, setZoom] = useState<string | null>(null)
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
    () => collapseBursts(collapseRepeats(events.filter(e => matchEvent(e, filter)).slice().reverse())),
    [events, filter]
  )

  const rowGaps = useMemo(() => gaps(rows.map(e => e.ts)), [rows])

  // Tick only while a call is in flight — an idle feed must not re-render every second.
  const anyRunning = useMemo(() => rows.some(isRunning), [rows])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!anyRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [anyRunning])

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
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-4 py-1.5">
        <Button size="sm" variant={view === 'timeline' ? 'secondary' : 'ghost'}
          onClick={() => setView('timeline')}>{t('view.timeline')}</Button>
        <Button size="sm" variant={view === 'tree' ? 'secondary' : 'ghost'}
          onClick={() => setView('tree')}>{t('view.byTopic')}</Button>
      </div>
      {filtersOpen && (
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <ToggleGroup multiple size="sm" variant="outline" value={kinds} onValueChange={v => setKinds(v as string[])}>
          {ALL_KINDS.map((k: string) => (
            <ToggleGroupItem key={k} value={k} aria-label={t(`kind.${k}`)}>
              <KindGlyph kind={k} className="mr-1" />{t(`kind.${k}`)}
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
      </div>
      )}
      {!pinned && unseen > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
          <Button size="sm" variant="secondary" className="pointer-events-auto shadow"
            onClick={jumpToLatest}>{t('feed.newEvents', { n: unseen })}</Button>
        </div>
      )}

      <div ref={viewport} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto pt-1">
        {view === 'tree'
          ? <Tree events={rows} selected={selected} onSelect={onSelect} folderId={folderId} onZoom={setZoom} />
          : rows.length === 0
            ? <p className="text-muted-foreground p-8 text-center text-sm">
                {events.length === 0 ? t('feed.empty') : t('feed.emptyFiltered')}
              </p>
            : (
            <table className="w-full table-fixed text-sm">
              <tbody>
                {rows.map((e, i) => (
                  <Fragment key={e.id ?? `${e.ts}-${e.path}`}>
                  {isRunning(e) && (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <div className="ml-4 flex" style={{ height: gapPx(runningFor(e.ts, now)) }}>
                          <div className={cn('h-full border-l border-dashed',
                            isStalled(e.ts, now) ? 'border-amber-500/50' : 'border-lime-400/60 animate-pulse')} />
                          <span className={cn('self-end pb-0.5 pl-1.5 text-[10px] tabular-nums',
                            isStalled(e.ts, now) ? 'text-amber-500/70' : 'text-lime-400/80')}>
                            {fmtGap(runningFor(e.ts, now)) || '0s'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                  <tr
                    onClick={() => onSelect(e)}
                    className={cn('hover:bg-muted/50 cursor-pointer',
                      selected?.id === e.id && 'bg-muted')}>
                    <td className="w-24 px-3 py-1 align-top">
                      <div className="text-muted-foreground font-mono text-xs tabular-nums">{fmtTime(e.ts)}</div>
                      {/* elapsed time made visible: the dash spans the gap to the
                          older event below, so a burst reads dense and a pause reads long */}
                      {rowGaps[i] > 0 && (
                        <div className="relative ml-1 flex" style={{ height: gapPx(rowGaps[i]) }}>
                          {/* 25% on a dark ground was invisible, so the duration label
                              floated with nothing to explain it */}
                          <div className="border-muted-foreground/60 h-full border-l border-dashed" />
                          {(gapPx(rowGaps[i]) >= 14 || isCapped(rowGaps[i])) && (
                            <span className={cn('text-muted-foreground/70 self-center pl-1.5 text-[10px] tabular-nums',
                              isCapped(rowGaps[i]) && 'text-amber-500/60')}>
                              {isCapped(rowGaps[i]) ? `↕ ${fmtGap(rowGaps[i])}` : fmtGap(rowGaps[i])}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="w-6 py-1 align-top">
                      <KindGlyph kind={e.kind} pulse={isRunning(e)} />
                    </td>
                    <td className="max-w-0 py-1 pr-2 align-top">
                      <div className="flex min-w-0 items-center gap-2"
                        title={e.burst ? e.burst.paths.join('\n') : rowText(e)}>
                        <ToolLabel tool={e.tool} className="shrink-0" />
                        {typeof e.detail?.durationMs === 'number' && e.detail.durationMs >= 1000 && (
                          <span className="text-muted-foreground/60 shrink-0 font-mono text-[10px] tabular-nums">
                            {fmtGap(e.detail.durationMs)}
                          </span>
                        )}
                        {e.path && isImagePath(e.path) && e.kind !== 'deleted' && (
                          <Thumb folderId={folderId} path={e.path} onOpen={setZoom} />
                        )}
                        {/* a burst already names its count in the label */}
                        {!e.burst && e.repeat && e.repeat > 1 && (
                          <span className="bg-muted text-muted-foreground shrink-0 rounded px-1 font-mono text-[10px] tabular-nums">
                            {t('feed.repeat', { n: e.repeat })}
                          </span>
                        )}
                        <span className={cn('truncate text-xs',
                          isAuthored(e) ? AUTHORED_TONE : 'font-mono',
                          e.path && running?.has(e.path) && 'orch-pulse-soft')}>
                          {e.burst
                            ? <span className="text-muted-foreground/60">
                                {e.burst.dir ? `${e.burst.dir}/` : ''}
                                <span className="text-foreground">{t('feed.burstFiles', { n: e.burst.count })}</span>
                              </span>
                            : e.path
                              // a tool row that names a file is still a path, and
                              // its folders should be muted like any other
                              ? <FilePath path={rowText(e)} />
                              : rowText(e)}
                        </span>
                      </div>
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
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        {evicted > 0 && (
          <p className="text-muted-foreground border-t p-3 text-center text-xs">{t('feed.olderInHistory')}</p>
        )}
      </div>
      <Lightbox folderId={folderId} path={zoom} onClose={() => setZoom(null)} />
    </div>
  )
}
