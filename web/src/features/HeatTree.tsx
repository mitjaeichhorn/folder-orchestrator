import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { config } from '@/config'
import { emptyHeat, touchAll, heatOf, prune, type HeatState } from './heat'
import type { OrchEvent } from '@/lib/api'
import { t } from '@/i18n'

interface Node { n: string; p: string; d: 0 | 1; c?: Node[] }
interface TreeResponse { nodes: number; truncated: boolean; children: Node[] }

/** Heat drives opacity and a warm tint; both scale together so hot reads as hot. */
function heatStyle (h: number) {
  return {
    opacity: 0.28 + h * 0.72,
    color: h > 0.02
      ? `color-mix(in oklab, var(--color-amber-300) ${Math.round(h * 100)}%, var(--color-muted-foreground))`
      : undefined
  }
}

function Branch ({ node, heat, depth, open, toggle }: {
  node: Node
  heat: HeatState
  depth: number
  open: Set<string>
  toggle: (p: string) => void
}) {
  const h = heatOf(heat, node.p)
  const isOpen = open.has(node.p)
  const style = { ...heatStyle(h), paddingLeft: depth * 10 + 4 }

  if (node.d === 0) {
    return (
      <div className="truncate py-px font-mono text-[10px] leading-tight" style={style} title={node.p}>
        {node.n}
      </div>
    )
  }
  return (
    <div>
      <button onClick={() => toggle(node.p)}
        className="hover:bg-muted/40 flex w-full items-center gap-0.5 truncate py-px text-left font-mono text-[10px] leading-tight"
        style={style} title={node.p}>
        {isOpen
          ? <ChevronDown className="size-2.5 shrink-0" />
          : <ChevronRight className="size-2.5 shrink-0" />}
        <span className="truncate">{node.n}</span>
      </button>
      {isOpen && node.c?.map(c => (
        <Branch key={c.p} node={c} heat={heat} depth={depth + 1} open={open} toggle={toggle} />
      ))}
    </div>
  )
}

export function HeatTree ({ folderId, events }: { folderId: string; events: OrchEvent[] }) {
  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [error, setError] = useState(false)

  useEffect(() => {
    setTree(null); setError(false)
    fetch(`${config.apiBase}/api/tree?folder=${encodeURIComponent(folderId)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: TreeResponse) => {
        setTree(data)
        // top level open by default; everything below closed, so a closed folder
        // lighting up is the signal that something inside it changed
        setOpen(new Set(data.children.filter(c => c.d === 1).map(c => c.p)))
      })
      .catch(() => setError(true))
  }, [folderId])

  // Heat is derived from the event list, in order. Recomputed from scratch so it
  // always matches what the feed shows — no separate accumulator to drift.
  const heat = useMemo(
    () => prune(touchAll(emptyHeat(), events.map(e => e.path))),
    [events]
  )

  const toggle = (p: string) => setOpen(s => {
    const n = new Set(s)
    if (n.has(p)) n.delete(p); else n.add(p)
    return n
  })

  const roots = useMemo(() => tree?.children ?? [], [tree])

  return (
    <div className="flex h-full min-h-0 flex-col border-l">
      <div className="text-muted-foreground flex items-center gap-2 border-b px-2 py-1.5 text-xs">
        <span className="uppercase">{t('heat.title')}</span>
        {tree && <span className="ml-auto tabular-nums">{t('heat.nodes', { n: tree.nodes })}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {error
          ? <p className="text-muted-foreground p-3 text-xs">{t('heat.error')}</p>
          : !tree
            ? <p className="text-muted-foreground p-3 text-xs">{t('heat.loading')}</p>
            : (
              <>
                {roots.map(n => (
                  <Branch key={n.p} node={n} heat={heat} depth={0} open={open} toggle={toggle} />
                ))}
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
