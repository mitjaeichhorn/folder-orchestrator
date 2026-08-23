import { parseTool } from './tool-name'
import { cn } from '@/lib/utils'

/**
 * `mcp__playwright__browser_take_screenshot` renders as a server pill plus the
 * tool name, so the repeated prefix stops competing with the part that differs.
 */
export function ToolLabel ({ tool, className }: { tool: string | null; className?: string }) {
  const p = parseTool(tool)
  if (!p) return null
  if (!p.mcp) {
    // Plain tool names (Bash, Read, Edit) repeat on nearly every row — muted, so
    // the description or path beside them is what the eye lands on. Same reason
    // directories are muted and filenames are not.
    return <span className={cn('text-muted-foreground/70 font-mono text-xs', className)}>{p.name}</span>
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
