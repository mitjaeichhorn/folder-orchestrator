import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react'
import { config } from '@/config'
import { useDebounced } from '@/hooks/useDebounced'
import { emptyHeat, touchAll, heatPaths, heatOf, prune, justChanged, stampOf, inGrade, type HeatState } from './heat'
import { activeFolders, allFolders, shouldPulse } from './prune-tree'
import { treeFromPaths } from './tree-from-paths'
import { showsLineBadge, lineIconTone } from '../shared/lines'
import { chainOf, revealPredicate, isOpenWith, LOCATE_CHAIN_CLASS, LOCATE_TARGET_CLASS } from './locate'
import { newestEventByPath } from '../files/group-by-file'
import { heatStyle } from './heat-color'
import { LINE_ALERT_AT } from '@shared/glob.js'
import { Switch } from '@/components/ui/switch'
import { FoldVertical } from 'lucide-react'
import type { OrchEvent } from '@/lib/api'
import { t, fmtNum } from '@/i18n'
import { cn } from '@/lib/utils'

/** Coalesce a burst of structural changes into one refetch. */
interface Node { n: string; p: string; d: 0 | 1; c?: Node[] }
interface TreeResponse { nodes: number; truncated: boolean; children: Node[] }

const countNodes = (nodes: Node[]): number =>
  nodes.reduce((n, x) => n + 1 + (x.c ? countNodes(x.c) : 0), 0)



const EMPTY_CHAIN: ReadonlySet<string> = new Set<string>()

function Branch ({ node, heat, depth, closed, toggle, running, chain, openable, onOpenFile, lines }: {
  node: Node
  heat: HeatState
  depth: number
  closed: Set<string>
  toggle: (p: string) => void
  running?: Set<string>
  chain?: ReadonlySet<string>
  /** Paths with an event behind them — the only ones the panel can describe. */
  openable?: ReadonlySet<string>
  onOpenFile?: (path: string) => void
  /** Path -> line count, for the long-file mark. */
  lines?: Map<string, number>
}) {
  const h = heatOf(heat, node.p)
  const isOpen = isOpenWith(closed, chain ?? EMPTY_CHAIN, node.p)
  const onChain = chain?.has(node.p) ?? false
  // last element of the chain is the file itself
  const isTarget = onChain && node.d === 0
  const style = { ...heatStyle(h), paddingLeft: depth * 10 + 4 }
  // The stamp in the key remounts the node on every touch, which is what makes
  // the CSS animation replay — re-rendering the same element would not.
  const flash = justChanged(heat, node.p)
  const flashKey = flash ? stampOf(heat, node.p) : 'idle'
  const pulsing = shouldPulse(node, running, h)
  // at full heat heatColor returns pure white; weight carries the same signal
  // for anyone who cannot separate white from near-white at 10px
  const justEdited = h >= 1

  if (node.d === 0) {
    // Same rule and the same tiers as the By-file list, in the space a 10px tree
    // row has: an icon rather than the pill, pushed right, tinted by length.
    const n = lines?.get(node.p)
    const longMark = showsLineBadge(n) && typeof n === 'number'
      ? (
        // the title lives on a wrapper: lucide icons take no title prop
        <span className="ml-auto shrink-0"
          title={t('files.longFile', { n: fmtNum(n), at: fmtNum(LINE_ALERT_AT) })}>
          <TriangleAlert className={cn('size-3', lineIconTone(n))}
            aria-label={t('files.lines', { n: fmtNum(n) })} />
        </span>
        )
      : null
    const shared = cn('flex w-full items-center gap-1 rounded-sm py-px text-left font-mono text-[10px] leading-tight',
      justEdited && 'font-bold', flash && 'orch-flash', pulsing && 'orch-pulse',
      onChain && LOCATE_CHAIN_CLASS, isTarget && LOCATE_TARGET_CLASS)
    // Only a file we have an event for can open the panel — the panel describes
    // an event (diff, actor, duration), and the tree lists every file in the
    // project including ones we have never seen change. Those stay inert rather
    // than offering a click that does nothing.
    if (!onOpenFile || !openable?.has(node.p)) {
      return (
        <div key={flashKey} className={shared} style={style} title={node.p}>
          <span className="truncate">{node.n}</span>{longMark}
        </div>
      )
    }
    return (
      <button key={flashKey} onClick={() => onOpenFile(node.p)}
        className={cn(shared, 'hover:bg-muted/40 cursor-pointer')}
        style={style} title={node.p}>
        <span className="truncate">{node.n}</span>{longMark}
      </button>
    )
  }
  return (
    <div>
      <button key={flashKey} onClick={() => toggle(node.p)}
        className={cn('hover:bg-muted/40 flex w-full items-center gap-0.5 truncate rounded-sm py-px text-left font-mono text-[10px] leading-tight',
          justEdited && 'font-bold', flash && 'orch-flash', pulsing && 'orch-pulse',
          onChain && LOCATE_CHAIN_CLASS)}
        style={style} title={node.p}>
        {isOpen
          ? <ChevronDown className="size-2.5 shrink-0" />
          : <ChevronRight className="size-2.5 shrink-0" />}
        <span className="truncate">{node.n}</span>
      </button>
      {isOpen && node.c?.map(c => (
        <Branch key={c.p} node={c} heat={heat} depth={depth + 1} closed={closed} toggle={toggle}
          running={running} chain={chain} openable={openable} onOpenFile={onOpenFile} lines={lines} />
      ))}
    </div>
  )
}

export function HeatTree ({ folderId, events, running, hoverPath, onOpenFile, lines }: {
  folderId: string
  events: OrchEvent[]
  running?: Set<string>
  hoverPath?: string | null
  onOpenFile?: (path: string) => void
  /** Path -> line count, shared with the feed and By file. */
  lines?: Map<string, number>
}) {
  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [error, setError] = useState(false)
  const [activeOnly, setActiveOnly] = useState(true)
  const firstLoad = useRef(true)

  // A created or deleted file changes the SHAPE of the tree, so the structure
  // has to be refetched — heat alone cannot show a path that is not there.
  // Modifications never change the shape, so they must not trigger a refetch.
  const structureVersion = useMemo(
    () => events.reduce((n, e) => n + (e.kind === 'created' || e.kind === 'deleted' || e.kind === 'renamed' ? 1 : 0), 0),
    [events]
  )
  const debounced = useDebounced(structureVersion, 1200)

  useEffect(() => {
    if (firstLoad.current) { setTree(null); setError(false) }
    fetch(`${config.apiBase}/api/tree?folder=${encodeURIComponent(folderId)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: TreeResponse) => {
        setTree(data)
        setError(false)
        if (firstLoad.current) firstLoad.current = false
      })
      .catch(() => { if (firstLoad.current) setError(true) })
  }, [folderId, debounced])

  useEffect(() => { firstLoad.current = true }, [folderId])

  // Heat is derived from the event list, in order. Recomputed from scratch so it
  // always matches what the feed shows — no separate accumulator to drift.
  const heat = useMemo(
    () => prune(touchAll(emptyHeat(), heatPaths(events))),
    [events]
  )

  const toggle = (p: string) => setClosed(s => {
    const n = new Set(s)
    if (n.has(p)) n.delete(p); else n.add(p)
    return n
  })

  // which paths the panel can actually describe
  const openable = useMemo(() => new Set(newestEventByPath(events).keys()), [events])

  // Inside the grade, not merely stamped: a path that has dimmed to the floor
  // has nothing left to say, and at a 1000-event backfill 57 of 88 were exactly
  // that. See `inGrade`.
  const isActive = (p: string) => inGrade(heat, p)
  // Derived, never stored: `closed` and `activeOnly` are untouched, so leaving the
  // row restores the tree exactly by simply dropping this override.
  const chain = useMemo(() => chainOf(hoverPath), [hoverPath])

  const roots = useMemo(() => {
    // "Active only" builds its tree from the stamped paths themselves rather
    // than pruning the fetched one. It is derived from the events, so it cannot
    // be affected by anything the tree walk does or does not reach — which is
    // what broke it when /api/tree still had a node cap.
    if (activeOnly) {
      const reveal = revealPredicate(isActive, chain)
      return treeFromPaths([...heat.stamps.keys()].filter(reveal))
    }
    return tree?.children ?? []
    // keyed on heat.tick rather than heat: rebuilding on every render is the one
    // thing here that could get expensive
  }, [tree, activeOnly, heat.tick, chain])

  /** Collapse every folder that has not been touched; leave the active ones open. */
  const collapseInactive = () => {
    if (!tree) return
    const active = new Set(activeFolders(tree.children as never, isActive))
    setClosed(new Set(allFolders(tree.children as never).filter(p => !active.has(p))))
  }

  return (
    <div data-slot="heat-tree" data-hover={hoverPath ?? ''} className="flex h-full min-h-0 flex-col border-l">
      <div className="text-muted-foreground flex shrink-0 items-center gap-2 border-b px-2 py-1.5 text-xs">
        <span className="uppercase">{t('heat.title')}</span>
        <button onClick={collapseInactive} title={t('heat.collapseInactive')}
          className="hover:text-foreground ml-auto shrink-0">
          <FoldVertical className="size-3.5" />
        </button>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5" title={t('heat.activeOnlyHint')}>
          <span>{t('heat.activeOnly')}</span>
          <Switch checked={activeOnly} onCheckedChange={setActiveOnly} className="scale-75" />
        </label>
      </div>
      {tree && (
        <div className="text-muted-foreground/60 flex shrink-0 items-center justify-between border-b px-2 py-1 text-[10px] tabular-nums">
          <span>{t('heat.nodes', { n: activeOnly ? countNodes(roots) : tree.nodes })}</span>
          {activeOnly && <span>{t('heat.ofTotal', { n: tree.nodes })}</span>}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {error
          ? <p className="text-muted-foreground p-3 text-xs">{t('heat.error')}</p>
          : !tree
            ? <p className="text-muted-foreground p-3 text-xs">{t('heat.loading')}</p>
            : (
              <>
                {roots.map(n => (
                  <Branch key={n.p} node={n} heat={heat} depth={0} closed={closed} toggle={toggle}
                    running={running} chain={chain} openable={openable} onOpenFile={onOpenFile} lines={lines} />
                ))}
                {activeOnly && roots.length === 0 && (
                  <p className="text-muted-foreground p-3 text-[10px]">{t('heat.noneActive')}</p>
                )}
              </>
            )}
      </div>
    </div>
  )
}
