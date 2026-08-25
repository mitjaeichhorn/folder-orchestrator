import { segmentsOf, sharesPrefix } from './path-prefix'
import { usePathHover } from './path-hover'
import { cn } from '@/lib/utils'

/**
 * Renders `__documentation/source-of-truth/event-contract.md` with the folders
 * muted and the filename at full contrast — the filename is what the eye scans
 * for; the path is context.
 *
 * Every segment is a hover target — folders and the filename alike. Pointing at
 * one lights that prefix in every other path on screen and reveals it in the
 * heat tree, so "what else is happening under here" is a hover rather than a
 * search. It replaced a per-row button that did the same for the file only.
 *
 * The tint is the locate blue on purpose: both answer "where is this", and a
 * second colour for the same question would read as a second signal.
 */
export function FilePath ({ path, className }: { path: string; className?: string }) {
  const { prefix, setPrefix } = usePathHover()
  const segs = segmentsOf(path)
  if (!segs.length) return null
  const lit = sharesPrefix(path, prefix)

  return (
    <span className={cn('font-mono', className)}>
      {segs.map((s, i) => {
        // a segment is highlighted when it is inside the hovered prefix
        const inPrefix = lit && s.prefix.length <= (prefix as string).length
        return (
          <span key={s.prefix}>
            {i > 0 && <span className="text-muted-foreground/40">/</span>}
            <span
              onMouseEnter={() => setPrefix(s.prefix)}
              onMouseLeave={() => setPrefix(null)}
              className={cn(
                s.isFile ? 'text-foreground' : 'text-muted-foreground/60',
                'hover:text-blue-300',
                inPrefix && 'rounded-sm bg-blue-400/20 text-blue-200')}>
              {s.name}
            </span>
          </span>
        )
      })}
    </span>
  )
}
