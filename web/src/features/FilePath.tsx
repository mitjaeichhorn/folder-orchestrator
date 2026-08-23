import { cn } from '@/lib/utils'

/**
 * Renders `__documentation/source-of-truth/event-contract.md` with the folders
 * muted and the filename at full contrast — the filename is what the eye scans
 * for; the path is context.
 */
export function FilePath ({ path, className }: { path: string; className?: string }) {
  const i = path.lastIndexOf('/')
  const dir = i === -1 ? '' : path.slice(0, i + 1)
  const base = i === -1 ? path : path.slice(i + 1)
  return (
    <span className={cn('font-mono', className)}>
      {dir && <span className="text-muted-foreground/60">{dir}</span>}
      <span className="text-foreground">{base}</span>
    </span>
  )
}
