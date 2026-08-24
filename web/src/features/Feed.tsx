import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { matchEvent, ALL_KINDS } from '@shared/glob.js'
import { gaps, gapPx, fmtGap, isRunning, runningFor, isStalled } from './timeline'
import { Lightbox } from './Lightbox'
import { collapseRepeats, collapseBursts, nestByCall, visibleCount } from './collapse'
import { deletedPaths } from './churn'
import { sessionTones, sessionsIn, isMultiSession, shortSession } from './session-color'
import { parseTool } from './tool-name'
import { recurring } from './entities'
import { rowText } from './event-view'
import { FeedRow } from './FeedRow'
import { FileList } from './FileList'
import { LaneView } from './LaneView'
import { KindGlyph } from './KindGlyph'
import { Tree } from './Tree'
import type { OrchEvent } from '@/lib/api'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

const WINDOWS = [
  { key: 'window.15m', ms: 15 * 60_000 },
  { key: 'window.1h', ms: 60 * 60_000 },
  { key: 'window.24h', ms: 24 * 3600_000 },
  { key: 'window.all', ms: 0 }
]


export function Feed ({
  events, evicted, selected, onSelect, folderId, filtersOpen = true, running, onLocate, locatable,
  treeRows, treeError, lines, sessionNames
}: {
  events: OrchEvent[]
  evicted: number
  selected: OrchEvent | null
  onSelect: (e: OrchEvent) => void
  folderId: string
  filtersOpen?: boolean
  running?: Set<string>
  onLocate?: (path: string | null) => void
  locatable?: boolean
  treeRows: Array<{ p: string; m?: number; l?: number }> | null
  treeError: boolean
  lines: Map<string, number>
  /** Claude Code's own name per session, where it has chosen one. */
  sessionNames?: Map<string, string>
}) {
  const [kinds, setKinds] = useState<string[]>([])
  const [pathGlob, setPathGlob] = useState('')
  const [windowMs, setWindowMs] = useState(0)
  const [view, setView] = useState<'timeline' | 'tree' | 'files' | 'lanes'>('timeline')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [pinned, setPinned] = useState(true)
  // track what is COLLAPSED, mirroring HeatTree: a call arriving later is open
  const [collapsedCalls, setCollapsedCalls] = useState<Set<string>>(new Set())
  const toggleCall = (id: string) => setCollapsedCalls(s => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  const [unseen, setUnseen] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)

  const filter = useMemo(() => ({
    kinds: kinds.length ? kinds : undefined,
    pathGlob: pathGlob.trim() || undefined,
    since: windowMs ? Date.now() - windowMs : undefined,
    sessionId: sessionId ?? undefined
  }), [kinds, pathGlob, windowMs, sessionId])

  // Which agents are present. Derived from the UNFILTERED list, or selecting one
  // session would remove every other chip and strand the operator inside it.
  const sessions = useMemo(() => sessionsIn(events), [events])
  const tones = useMemo(() => sessionTones(sessions), [sessions])
  const multi = isMultiSession(sessions)

  // the ONE predicate — same module the server uses
  const flatRows = useMemo(
    () => collapseBursts(collapseRepeats(events.filter(e => matchEvent(e, filter)).slice().reverse())),
    [events, filter]
  )
  // nesting runs LAST: both collapse passes need a flat, time-ordered array
  const rows = useMemo(() => nestByCall(flatRows), [flatRows])

  const rowGaps = useMemo(() => gaps(rows.map(e => e.ts)), [rows])
  // Scoped to what is on screen, deliberately: a name is worth marking because it
  // recurs among the rows the operator is reading, not across the whole history.
  const marks = useMemo(() => recurring(flatRows.map(rowText)), [flatRows])
  // do not request a thumbnail for a file we have already seen deleted
  const gone = useMemo(() => deletedPaths(flatRows), [flatRows])

  // Tick only while a call is in flight — an idle feed must not re-render every second.
  const anyRunning = useMemo(() => rows.some(isRunning), [rows])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!anyRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [anyRunning])

  // Count what is on SCREEN, not top-level rows. Adopting a file into a call
  // shrinks the top level, so a genuinely new event could otherwise produce
  // grew <= 0 and the pill would silently miss it.
  const seenNow = useMemo(() => visibleCount(rows), [rows])
  const lastCount = useRef(seenNow)
  useEffect(() => {
    const grew = seenNow - lastCount.current
    lastCount.current = seenNow
    if (grew <= 0) return
    if (pinned) viewport.current?.scrollTo({ top: 0 })
    else setUnseen(n => n + grew)
  }, [seenNow, pinned])

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
        <Button size="sm" variant={view === 'files' ? 'secondary' : 'ghost'}
          onClick={() => setView('files')}>{t('view.byFile')}</Button>
        <Button size="sm" variant={view === 'lanes' ? 'secondary' : 'ghost'}
          onClick={() => setView('lanes')}>{t('view.byLane')}</Button>
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
        {multi && (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground text-xs">{t('feed.sessions')}</span>
            {sessions.map(id => (
              <Button key={id} size="sm"
                variant={sessionId === id ? 'secondary' : 'ghost'}
                className={cn('h-7 max-w-60 px-1.5 text-xs', tones.get(id))}
                title={sessionNames?.get(id)
                  ? t('feed.sessionChip', { id, name: sessionNames.get(id) as string })
                  : t('feed.sessionChipUnnamed', { id })}
                onClick={() => setSessionId(cur => (cur === id ? null : id))}>
                <span className="truncate">
                  {/* The name if Claude Code has chosen one, the id until then.
                      A young session is unnamed for its first minute. */}
                  {sessionNames?.get(id) ?? shortSession(id)}
                </span>
              </Button>
            ))}
          </div>
        )}
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
        {view === 'lanes'
          // flatRows, not rows: lanes place every event themselves, and the
          // nested shape would hide each adopted child inside its parent
          ? <LaneView events={flatRows} selected={selected} onSelect={onSelect}
              sessionTones={tones} sessionNames={sessionNames} />
          : view === 'files'
          // flatRows for the same reason as the topic view: this one aggregates
          // per file itself, so it needs every event, not the nested shape
          ? <FileList events={flatRows} folderId={folderId} onSelect={onSelect}
              onLocate={onLocate} locatable={locatable} onZoom={setZoom}
              tree={treeRows} error={treeError} />
          : view === 'tree'
          // flatRows, not rows: the topic tree groups every event itself, and
          // handing it the nested array would hide every adopted child
          ? <Tree events={flatRows} selected={selected} onSelect={onSelect} folderId={folderId}
              onZoom={setZoom} lines={lines} />
          : rows.length === 0
            ? <p className="text-muted-foreground p-8 text-center text-sm">
                {events.length === 0 ? t('feed.empty') : t('feed.emptyFiltered')}
              </p>
            : (
            <table className="w-full table-fixed text-sm">
              {/* table-fixed takes its widths from the first row, and the first
                  row is a colSpan={5} running indicator whenever a call is in
                  flight — which collapsed the layout into five equal columns.
                  A colgroup pins the widths regardless of what the first row is. */}
              <colgroup>
                <col className="w-24" />
                <col className="w-6" />
                <col />
                <col className="w-48" />
                {/* table-fixed takes widths from here, not from the <td> — widening
                    the cell alone leaves it at the colgroup's width */}
                <col className="w-24" />
              </colgroup>
              <tbody>
                {rows.map((e, i) => (
                  <Fragment key={e.id ?? `${e.ts}-${e.path}`}>
                  {isRunning(e) && (
                    <tr>
                      <td colSpan={5} className="p-0">
                        {/* The dash grows UP from its row toward now. Without a
                            marker at the top it runs off the list and there is
                            nothing visible it is counting to. */}
                        <div className="ml-4 flex flex-col justify-end"
                          title={t('feed.runningHint', { d: fmtGap(runningFor(e.ts, now)) || '0s' })}
                          style={{ height: gapPx(runningFor(e.ts, now)) + 14 }}>
                          <div className="flex items-center gap-1.5 pb-0.5">
                            <span className={cn('-ml-[3px] inline-block size-1.5 shrink-0 rounded-full',
                              isStalled(e.ts, now) ? 'bg-amber-500/70' : 'bg-lime-400 orch-pulse')} />
                            {/* Name what is running and for how long. A bare "now" left the
                                empty space above the first row unexplained — it read as an
                                orphan line rather than as a wait being measured. Short tool
                                name, the same split ToolLabel uses on the row below. */}
                            <span className={cn('text-[10px]',
                              isStalled(e.ts, now) ? 'text-amber-500/70' : 'text-lime-400/70')}>
                              {t('feed.runningNow', {
                                tool: parseTool(e.tool)?.name ?? t(`kind.${e.kind}`),
                                d: fmtGap(runningFor(e.ts, now)) || '0s'
                              })}
                            </span>
                          </div>
                          <div className={cn('min-h-0 flex-1 border-l border-dashed',
                            isStalled(e.ts, now) ? 'border-amber-500/50' : 'border-lime-400/60')} />
                        </div>
                      </td>
                    </tr>
                  )}
                  <FeedRow
                    e={e} gap={rowGaps[i]} now={now} depth={0} marks={marks}
                    ditto={rows[i - 1]?.tool === e.tool}
                    folderId={folderId} selected={selected} onSelect={onSelect}
                    running={running} onZoom={setZoom} gone={gone} lines={lines}
                    sessionTone={multi ? tones.get(e.sessionId ?? '') : undefined}
                    sessionName={sessionNames?.get(e.sessionId ?? '')}
                    onLocate={onLocate} locatable={locatable}
                    expanded={!collapsedCalls.has(String(e.id))}
                    onToggle={() => toggleCall(String(e.id))} />
                  {!collapsedCalls.has(String(e.id)) && e.children?.map(c => (
                    <FeedRow key={c.id ?? `${c.ts}-${c.path}`}
                      e={c} gap={0} now={now} depth={1} marks={marks}
                      folderId={folderId} selected={selected} onSelect={onSelect}
                      running={running} onZoom={setZoom} gone={gone} lines={lines}
                      sessionTone={multi ? tones.get(c.sessionId ?? '') : undefined}
                      sessionName={sessionNames?.get(c.sessionId ?? '')}
                      onLocate={onLocate} locatable={locatable} />
                  ))}
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
