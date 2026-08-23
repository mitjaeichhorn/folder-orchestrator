import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchEvent, globToRe, ALL_KINDS } from '../../shared/glob.js'
import { groupBySession, filesTouched, isRunning, RUNNING_WINDOW, UNATTRIBUTED } from '../src/features/session-logic.ts'
import { isAuthored, AUTHORED_TONE } from '../src/features/authored.ts'
import { parseTool } from '../src/features/tool-name.ts'
import { fmtTokens } from '../src/features/usage-format.ts'

const ev = (o: any) => ({ id: 1, folderId: 'F', ts: 1000, kind: 'modified', path: 'a.ts', actor: 'external', sessionId: null, tool: null, detail: {}, ...o })

test('the filter predicate is the same module the server imports', async () => {
  const serverIgnore = await import('../../server/ignore.js')
  assert.equal(serverIgnore.globToRe, globToRe, 'server and client must share one implementation')
})

test('kind filter', () => {
  assert.equal(matchEvent(ev({ kind: 'created' }), { kinds: ['created'] }), true)
  assert.equal(matchEvent(ev({ kind: 'created' }), { kinds: ['deleted'] }), false)
  assert.equal(matchEvent(ev({ kind: 'created' }), {}), true)
})

test('glob filter matches server semantics', () => {
  assert.equal(matchEvent(ev({ path: 'src/a/b.tsx' }), { pathGlob: 'src/**/*.tsx' }), true)
  assert.equal(matchEvent(ev({ path: 'lib/a.tsx' }), { pathGlob: 'src/**/*.tsx' }), false)
  assert.equal(matchEvent(ev({ path: null }), { pathGlob: 'src/**' }), false, 'null path cannot match a glob')
  assert.equal(matchEvent(ev({ path: null }), { pathGlob: '**' }), true, '** is the no-op filter')
})

test('time window and actor and session filters', () => {
  assert.equal(matchEvent(ev({ ts: 500 }), { since: 1000 }), false)
  assert.equal(matchEvent(ev({ ts: 1500 }), { since: 1000 }), true)
  assert.equal(matchEvent(ev({ actor: 'claude' }), { actor: 'claude' }), true)
  assert.equal(matchEvent(ev({ actor: 'external' }), { actor: 'claude' }), false)
  assert.equal(matchEvent(ev({ sessionId: 'S1' }), { sessionId: 'S1' }), true)
})

test('combined filters are conjunctive', () => {
  const e = ev({ kind: 'deleted', path: 'src/x.ts', ts: 2000 })
  assert.equal(matchEvent(e, { kinds: ['deleted'], pathGlob: 'src/**', since: 1000 }), true)
  assert.equal(matchEvent(e, { kinds: ['deleted'], pathGlob: 'lib/**', since: 1000 }), false)
})

test('ALL_KINDS covers every contract kind', () => {
  assert.deepEqual([...ALL_KINDS].sort(), ['alert', 'created', 'deleted', 'modified', 'prompt', 'renamed', 'tool'].sort())
})

// --- session logic -------------------------------------------------------
test('grouping splits three sessions and ignores filesystem events', () => {
  const g = groupBySession([
    ev({ kind: 'tool', sessionId: 'A' }), ev({ kind: 'tool', sessionId: 'B' }),
    ev({ kind: 'prompt', sessionId: 'A' }), ev({ kind: 'modified', sessionId: 'A' }),
    ev({ kind: 'tool', sessionId: 'C' })
  ] as any)
  assert.deepEqual([...g.keys()], ['A', 'B', 'C'])
  assert.equal(g.get('A')!.length, 2, 'the modified event is not session data')
})

test('an event with no sessionId is grouped, never dropped', () => {
  const g = groupBySession([ev({ kind: 'tool', sessionId: null })] as any)
  assert.equal(g.get(UNATTRIBUTED)!.length, 1)
})

test('running/ended boundary, both sides, with an injected clock', () => {
  const now = 100_000
  assert.equal(isRunning(now - RUNNING_WINDOW + 1, now), true)
  assert.equal(isRunning(now - RUNNING_WINDOW - 1, now), false)
})

test('filesTouched dedups and drops null paths', () => {
  const files = filesTouched([
    ev({ path: 'a.ts' }), ev({ path: 'a.ts' }), ev({ path: 'b.ts' }), ev({ path: null })
  ] as any)
  assert.deepEqual(files, ['a.ts', 'b.ts'])
})

// --- authored-text tone --------------------------------------------------

test('a Bash description is authored text', () => {
  assert.equal(isAuthored(ev({
    kind: 'tool', tool: 'Bash', path: null,
    detail: { input: { command: 'ls', description: 'Check what the console errors are' } }
  })), true)
})

test('a user prompt is authored text', () => {
  assert.equal(isAuthored(ev({ kind: 'prompt', path: null, detail: { text: 'build' } })), true)
})

test('a bare command with no description is not authored text', () => {
  assert.equal(isAuthored(ev({
    kind: 'tool', tool: 'Bash', path: null, detail: { input: { command: 'ls' } }
  })), false, 'a raw command is a machine value, not a written label')
})

test('a path-bearing tool call is a fact, not a label', () => {
  assert.equal(isAuthored(ev({
    kind: 'tool', tool: 'Edit', path: 'a.ts', detail: { input: { description: 'x' } }
  })), false)
})

test('filesystem events are never authored text', () => {
  for (const kind of ['created', 'modified', 'deleted', 'renamed', 'alert']) {
    assert.equal(isAuthored(ev({ kind, path: 'a.ts' })), false, kind)
  }
})

test('the authored tone is neon green, upright', () => {
  assert.match(AUTHORED_TONE, /lime/, 'neon green')
  assert.doesNotMatch(AUTHORED_TONE, /italic/)
})

// --- MCP tool names ------------------------------------------------------
test('an MCP tool splits into server and tool name', () => {
  assert.deepEqual(parseTool('mcp__playwright__browser_take_screenshot'),
    { mcp: true, server: 'playwright', name: 'browser_take_screenshot' })
})

test('a server name containing underscores is not split early', () => {
  assert.deepEqual(parseTool('mcp__claude_ai_Google_Drive__search_files'),
    { mcp: true, server: 'claude_ai_Google_Drive', name: 'search_files' })
})

test('a tool name containing the separator keeps its tail intact', () => {
  const p = parseTool('mcp__srv__a__b')
  assert.equal(p!.server, 'srv')
  assert.equal(p!.name, 'a__b', 'only the first separator splits')
})

test('a plain tool is not treated as MCP', () => {
  assert.deepEqual(parseTool('Bash'), { mcp: false, server: null, name: 'Bash' })
  assert.deepEqual(parseTool('Edit'), { mcp: false, server: null, name: 'Edit' })
})

test('a malformed MCP name still yields something renderable', () => {
  assert.equal(parseTool('mcp__')!.name, 'mcp__')
  assert.equal(parseTool('mcp__lonely')!.name, 'lonely')
  assert.equal(parseTool('mcp__srv__')!.name, 'srv__')
})

test('null and empty tools yield null, not a crash', () => {
  assert.equal(parseTool(null), null)
  assert.equal(parseTool(undefined), null)
  assert.equal(parseTool(''), null)
})

// --- token formatting ----------------------------------------------------
test('token counts compact without losing the magnitude', () => {
  assert.equal(fmtTokens(0), '0')
  assert.equal(fmtTokens(999), '999')
  assert.equal(fmtTokens(1500), '1.5k')
  assert.equal(fmtTokens(25_000), '25k')
  assert.equal(fmtTokens(186_400), '186k')
  assert.equal(fmtTokens(25_644_155), '25.6M')
})

test('non-finite and negative token counts render as zero, never NaN', () => {
  for (const v of [NaN, Infinity, -5, -Infinity]) assert.equal(fmtTokens(v), '0')
})
