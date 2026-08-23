import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { config } from '@/config'
import { emptyHeat, touchAll, heatOf, prune, justChanged, stampOf, hasHeat, type HeatState } from './heat'
import { pruneToActive, activeFolders, allFolders, shouldPulse } from './prune-tree'
import { heatColor, heatOpacity } from './heat-color'
import { Switch } from '@/components/ui/switch'
import { FoldVertical } from 'lucide-react'
import type { OrchEvent } from '@/lib/api'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

/** Coalesce a burst of structural changes into one refetch. */
function useDebounced<T> (value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

interface Node { n: string; p: string; d: 0 | 1; c?: Node[] }
interface TreeResponse { nodes: number; truncated: boolean; children: Node[] }

const countNodes = (nodes: Node[]): number =>
  nodes.reduce((n, x) => n + 1 + (x.c ? countNodes(x.c) : 0), 0)

const heatStyle = (h: number) => ({ opacity: heatOpacity(h), color: heatColor(h) })

function Branch ({ node, heat, depth, closed, toggle, running }: {
  node: Node
  heat: HeatState
  depth: number
  closed: Set<string>
  toggle: (p: string) => void
  running?: Set<string>
}) {
  const h = heatOf(heat, node.p)
  const isOpen = !closed.has(node.p)
  const style = { ...heatStyle(h), paddingLeft: depth * 10 + 4 }
  // The stamp in the key remounts the node on every touch, which is what makes
  // the CSS animation replay — re-rendering the same element would not.
  const flash = justChanged(heat, node.p)
  const flashKey = flash ? stampOf(heat, node.p) : 'idle'
  const pulsing = shouldPulse(node, running)

  if (node.d === 0) {
    return (
      <div key={flashKey}
        className={cn('truncate rounded-sm py-px font-mono text-[10px] leading-tight',
          flash && 'orch-flash', pulsing && 'orch-pulse')}
        style={style} title={node.p}>
        {node.n}
      </div>
    )
  }
  return (
    <div>
      <button key={flashKey} onClick={() => toggle(node.p)}
        className={cn('hover:bg-muted/40 flex w-full items-center gap-0.5 truncate rounded-sm py-px text-left font-mono text-[10px] leading-tight',
          flash && 'orch-flash', pulsing && 'orch-pulse')}
        style={style} title={node.p}>
        {isOpen
          ? <ChevronDown className="size-2.5 shrink-0" />
          : <ChevronRight className="size-2.5 shrink-0" />}
        <span className="truncate">{node.n}</span>
      </button>
      {isOpen && node.c?.map(c => (
        <Branch key={c.p} node={c} heat={heat} depth={depth + 1} closed={closed} toggle={toggle} running={running} />
      ))}
    </div>
  )
}

export function HeatTree ({ folderId, events, running }: {
  folderId: string
  events: OrchEvent[]
  running?: Set<string>
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
    () => prune(touchAll(emptyHeat(), events.map(e => e.path))),
    [events]
  )

  const toggle = (p: string) => setClosed(s => {
    const n = new Set(s)
    if (n.has(p)) n.delete(p); else n.add(p)
    return n
  })

  const isActive = (p: string) => hasHeat(heat, p)

  const roots = useMemo(() => {
    const all = tree?.children ?? []
    return activeOnly ? pruneToActive(all as never, isActive) : all
    // keyed on heat.tick rather than heat: pruning a large tree on every render
    // is the one thing here that could get expensive
  }, [tree, activeOnly, heat.tick])

  /** Collapse every folder that has not been touched; leave the active ones open. */
  const collapseInactive = () => {
    if (!tree) return
    const active = new Set(activeFolders(tree.children as never, isActive))
    setClosed(new Set(allFolders(tree.children as never).filter(p => !active.has(p))))
  }

  return (
    <div data-slot="heat-tree" className="flex h-full min-h-0 flex-col border-l">
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
                  <Branch key={n.p} node={n} heat={heat} depth={0} closed={closed} toggle={toggle} running={running} />
                ))}
                {activeOnly && roots.length === 0 && (
                  <p className="text-muted-foreground p-3 text-[10px]">{t('heat.noneActive')}</p>
                )}
                {tree.truncated && (
                  <p className="text-muted-foreground border-t px-2 py-2 text-[10px]">{t('heat.truncated')}</p>
                )}
              </>
            )}
      </div>
      <p className="text-muted-foreground/70 border-t px-2 py-1.5 text-[10px] leading-snug">
        {t('heat.legend')}
      </p>
    </div>
  )
}
