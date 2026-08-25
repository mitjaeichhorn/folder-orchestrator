import { parseTool } from './tool-name'
import { cn } from '@/lib/utils'

/**
 * `mcp__playwright__browser_take_screenshot` renders as a server pill plus the
 * tool name, so the repeated prefix stops competing with the part that differs.
 */
export function ToolLabel ({ tool, className, ditto }: {
  tool: string | null
  className?: string
  /** The row above already said this. Fourteen rows reading `Bash` is a column of
      noise; the name is worth exactly one row of the run it starts. */
  ditto?: boolean
}) {
  const p = parseTool(tool)
  if (!p) return null
  if (!p.mcp) {
    // Plain tool names (Bash, Read, Edit) repeat on nearly every row — light
    // grey, so the description or path beside them is what the eye lands on.
    // Same reason directories are muted and filenames are not.
    // A repeat keeps the name in the DOM at low contrast rather than dropping it:
    // removing it would let the label beside it slide left and break the column.
    return (
      <span className={cn('font-mono text-xs', ditto ? 'text-zinc-400/25' : 'text-zinc-400', className)}
        title={ditto ? (tool ?? undefined) : undefined}>
        {p.name}
      </span>
    )
  }
  return (
    <span className={cn('flex min-w-0 items-center gap-1', className)} title={tool ?? undefined}>
      {p.server && (
        <span className="bg-violet-400 text-background shrink-0 rounded-full px-1.5 py-px font-mono text-[10px] leading-tight">
          {p.server}
        </span>
      )}
      <span className="font-mono text-xs text-violet-400">{p.name}</span>
    </span>
  )
}
