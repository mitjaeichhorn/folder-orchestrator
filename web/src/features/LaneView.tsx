import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { laneProfile, LANES, LANE_TONE, type Lane } from './lanes'
import { laneRows, openGaps } from './lane-layout'
import { gapPx, fmtGap, isCapped, isRunning } from './timeline'
import { FilePath } from './FilePath'
import { ToolLabel } from './ToolLabel'
import { KindGlyph } from './KindGlyph'
import { rowText } from './event-view'
import { isAuthored, AUTHORED_TONE, TOOL_DESC_TONE } from './authored'
import { sessionLabel } from './session-color'
import { AlertDot } from './AlertDot'
import type { Alert } from './alerts'
import type { OrchEvent } from '@/lib/api'
import { t, fmtTime, fmtNum } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Planning · work · test as tiles, on one clock, newest at the top like every
 * other view here.
 *
 * Time hangs DOWNWARD from each tile: the connector under a tile is the wait
 * that preceded it, measured back to the previous tile in the same lane, which
 * sits below it. So a tall connector under a tile means that tile arrived long
 * after the lane's last activity — you read the tile, then read down to see how
 * long it took to get there.
 *
 * The tile and the time are separate elements on purpose. While they were one
 * box, the tile's minimum readable height was also the floor on expressible
 * duration, so everything from 0 to ~3 seconds looked identical. Split, the tile
 * owns legibility and the connector owns duration, and the scale can start at
 * one second.
 *
 * Each lane keeps its own cadence: a connector measures back to the previous
 * tile IN THAT LANE, not to the row above. Work landing every few seconds while
 * Test climbs past ten minutes is the picture this view exists to show, and a
 * per-row gap would print the same number in all three columns.
 */
export function LaneView ({ events, selected, onSelect, sessionTones, sessionNames, alertsByPath, onOpenAlert }: {
  events: OrchEvent[]
  selected: OrchEvent | null
  onSelect: (e: OrchEvent) => void
  sessionTones?: Map<string, string>
  sessionNames?: Map<string, string>
  alertsByPath?: Map<string, Alert[]>
  onOpenAlert?: (a: Alert) => void
}) {
  // laneRows measures each gap against the previous tile in the same lane, so it
  // needs oldest-first; the display is then flipped back to newest-first.
  const asc = [...events].reverse()
  const rows = laneRows(asc as never).reverse()
  const profile = laneProfile(events)

  // Tick only while something is in flight, matching the feed: an idle view must
  // not re-render every second just to age its open connectors.
  const anyRunning = events.some(isRunning)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!anyRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [anyRunning])
  const open = openGaps(asc as never, now)

  // Pinned to the top, the same anchor as the feed: newest work arrives there.
  const viewport = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = viewport.current
    if (el && pinned.current) el.scrollTop = 0
  }, [rows.length])
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    pinned.current = e.currentTarget.scrollTop <= 4
  }

  if (events.length === 0) {
    return <p className="text-muted-foreground p-8 text-center text-sm">{t('feed.empty')}</p>
  }

  /**
   * The wait that preceded a tile, hanging below it toward the older tile it is
   * measured against. Its own element, so one second is still legible.
   */
  const Connector = ({ ms, live }: { ms: number | null; live?: boolean }) => {
    if (ms === null) return null
    const h = gapPx(ms)
    return (
      <div className="flex flex-col items-center justify-center"
        style={{ height: Math.max(h, 10) }}
        title={t(isCapped(ms) ? 'feed.gapCappedHint' : 'feed.gapHint', { d: fmtGap(ms) })}>
        <div className={cn('w-px flex-1', live ? 'bg-lime-400/50' : 'bg-muted-foreground/30')} />
        {(h >= 22 || isCapped(ms)) && (
          <span className={cn('py-0.5 text-[10px] tabular-nums',
            isCapped(ms) ? 'text-amber-500/70' : live ? 'text-lime-400/80' : 'text-muted-foreground/60')}>
            {isCapped(ms) ? `↕ ${fmtGap(ms)}` : fmtGap(ms)}
          </span>
        )}
        <div className={cn('w-px flex-1', live ? 'bg-lime-400/50' : 'bg-muted-foreground/30')} />
      </div>
    )
  }

  const Tile = ({ cell }: { cell: NonNullable<ReturnType<typeof laneRows>[number]['cells'][Lane]> }) => {
    const e = cell.ev as unknown as OrchEvent
    const lines = e.detail?.linesAdded
    return (
      <button onClick={() => onSelect(e)}
        title={cell.count > 1 ? cell.paths.join('\n') : (e.path ?? undefined)}
        className={cn('w-full min-w-0 rounded-md border px-2 py-1 text-left',
          'hover:bg-muted/50', selected?.id === e.id && 'bg-muted',
          // solid border = a call named this file; dashed = it merely changed
          // while one was running. Co-occurrence, not authorship.
          e.actor === 'claude' ? 'border-border' : 'border-dashed border-border/50')}>
        <span className="flex min-w-0 items-center gap-1.5">
          <KindGlyph kind={e.kind} pulse={isRunning(e)} />
          <span className="min-w-0 flex-1 font-mono text-xs break-words [overflow-wrap:anywhere]">
            {e.path ? <FilePath path={e.path} /> : rowText(e)}
          </span>
          {onOpenAlert && e.path && (alertsByPath?.get(e.path)?.length ?? 0) > 0 && (
            <AlertDot alerts={alertsByPath!.get(e.path)!} onOpen={onOpenAlert} />
          )}
          {cell.count > 1 && (
            <span className="bg-muted text-muted-foreground shrink-0 rounded px-1 font-mono text-[10px]">
              {t('lane.alsoFiles', { n: cell.count })}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
          {e.sessionId && (
            <span className={cn('min-w-0 shrink-0 truncate font-mono text-[10px]',
              sessionTones?.get(e.sessionId) ?? 'text-muted-foreground')}>
              {sessionLabel(sessionNames?.get(e.sessionId), e.sessionId)}
            </span>
          )}
          <span className="text-muted-foreground/60 shrink-0 font-mono text-[10px] tabular-nums">
            {fmtTime(e.ts)}
          </span>
          {typeof lines === 'number' && (
            <span className="ml-auto shrink-0 font-mono text-[10px] text-emerald-400">
              {t('detail.linesAdded', { n: lines })}
            </span>
          )}
        </span>
      </button>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      <div className="text-muted-foreground bg-background grid shrink-0 grid-cols-3 gap-2 border-b px-3 py-1.5 text-xs">
        {LANES.map(l => (
          <span key={l} className={cn('break-words', LANE_TONE[l])}>
            {t(`lane.${l}`)} · {fmtNum(profile[l])}
          </span>
        ))}
      </div>

      <div ref={viewport} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {/* Now is the ceiling: each lane opens with the silence since it last
            did anything, still growing. Work landing tiles while Test's opener
            climbs past ten minutes is the thing worth watching. */}
        <div className="grid grid-cols-3 items-start gap-x-2">
          {LANES.map(lane => (
            <div key={lane} className="min-w-0">
              {open[lane] !== undefined && <Connector ms={open[lane] as number} live />}
            </div>
          ))}
        </div>

        {rows.map((r, i) => r.spine
          ? (
            // Full width: the shared clock, and about half of all events
            <div key={r.spine.id ?? `s${i}`}
              className="border-muted/60 my-1 flex min-w-0 items-center gap-1.5 border-y border-dashed py-0.5">
              <span className="text-muted-foreground/60 shrink-0 font-mono text-[10px] tabular-nums">
                {fmtTime(r.spine.ts)}
              </span>
              <ToolLabel tool={(r.spine as unknown as OrchEvent).tool} className="shrink-0" />
              <button onClick={() => onSelect(r.spine as unknown as OrchEvent)}
                className={cn('hover:bg-muted/50 min-w-0 flex-1 rounded-sm px-1 text-left text-xs break-words [overflow-wrap:anywhere]',
                  isAuthored(r.spine as unknown as OrchEvent)
                    ? ((r.spine as unknown as OrchEvent).kind === 'tool' ? TOOL_DESC_TONE : AUTHORED_TONE)
                    : 'font-mono',
                  selected?.id === r.spine.id && 'bg-muted')}>
                {rowText(r.spine as unknown as OrchEvent)}
              </button>
              {r.spine.sessionId && (
                <Badge variant="outline"
                  className={cn('max-w-48 shrink-0 truncate', sessionTones?.get(r.spine.sessionId))}>
                  <span className="truncate">
                    {sessionLabel(sessionNames?.get(r.spine.sessionId), r.spine.sessionId)}
                  </span>
                </Badge>
              )}
            </div>
          )
          : (
            <>
            <div key={`r${i}`} className="grid grid-cols-3 items-start gap-x-2">
              {LANES.map(lane => {
                const cell = r.cells[lane]
                return (
                  <div key={lane} className="min-w-0">
                    {cell ? <><Tile cell={cell} /><Connector ms={cell.gapMs} /></> : null}
                  </div>
                )
              })}
            </div>
            </>
          ))}
      </div>
    </div>
  )
}
