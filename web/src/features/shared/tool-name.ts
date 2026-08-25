/**
 * MCP tool names arrive as `mcp__<server>__<tool>` — long, repetitive, and they
 * crowd out the part that actually differs. Split them so the server becomes a
 * pill and only the tool name is read as text.
 */
export interface ParsedTool {
  mcp: boolean
  server: string | null
  name: string
}

export function parseTool (tool: string | null | undefined): ParsedTool | null {
  if (!tool) return null
  if (!tool.startsWith('mcp__')) return { mcp: false, server: null, name: tool }
  const rest = tool.slice(5)
  const i = rest.indexOf('__')
  // `mcp__foo` with no second separator: treat the whole remainder as the name
  if (i === -1) return { mcp: true, server: null, name: rest || tool }
  const server = rest.slice(0, i)
  const name = rest.slice(i + 2)
  if (!server || !name) return { mcp: true, server: server || null, name: name || rest }
  return { mcp: true, server, name }
}
