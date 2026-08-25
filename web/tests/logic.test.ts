import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchEvent, globToRe, ALL_KINDS } from '../../shared/glob.js'
import { groupBySession, filesTouched, isRunning, RUNNING_WINDOW, UNATTRIBUTED } from '../src/features/sessions/session-logic.ts'
import { isAuthored, AUTHORED_TONE, TOOL_DESC_TONE } from '../src/features/feed/authored.ts'
import { parseTool } from '../src/features/shared/tool-name.ts'
import { fmtTokens } from '../src/features/usage/usage-format.ts'
import { collapseRepeats, collapseBursts, nestByCall, visibleCount } from '../src/features/feed/collapse.ts'
import { gaps } from '../src/features/shared/timeline.ts'

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

// --- collapsing repeated rows -------------------------------------------
const fs = (o: any) => ev({ kind: 'modified', ...o })

test('consecutive identical file events collapse into one counted row', () => {
  const out = collapseRepeats([
    fs({ id: 3, path: 'a.py', ts: 3000 }),
    fs({ id: 2, path: 'a.py', ts: 2800 }),
    fs({ id: 1, path: 'a.py', ts: 2600 })
  ] as any)
  assert.equal(out.length, 1)
  assert.equal(out[0].repeat, 3)
  assert.equal(out[0].id, 3, 'the newest row is the one kept')
})

test('a row that repeats only once carries no count', () => {
  const out = collapseRepeats([fs({ path: 'a.py', ts: 1000 })] as any)
  assert.equal(out[0].repeat, undefined, 'a single event must not be labelled x1')
})

test('events outside the window stay separate', () => {
  const out = collapseRepeats([
    fs({ path: 'a.py', ts: 10_000 }),
    fs({ path: 'a.py', ts: 1000 })
  ] as any)
  assert.equal(out.length, 2)
})

test('different paths, kinds or actors never merge', () => {
  assert.equal(collapseRepeats([fs({ path: 'a.py', ts: 2 }), fs({ path: 'b.py', ts: 1 })] as any).length, 2)
  assert.equal(collapseRepeats([fs({ path: 'a.py', ts: 2 }), fs({ path: 'a.py', ts: 1, kind: 'created' })] as any).length, 2)
  assert.equal(collapseRepeats([fs({ path: 'a.py', ts: 2, actor: 'claude' }), fs({ path: 'a.py', ts: 1, actor: 'external' })] as any).length, 2)
})

test('tool and prompt rows are never collapsed — each is separate work', () => {
  const out = collapseRepeats([
    ev({ kind: 'tool', tool: 'Bash', path: null, ts: 2000 }),
    ev({ kind: 'tool', tool: 'Bash', path: null, ts: 1900 })
  ] as any)
  assert.equal(out.length, 2)
})

test('alerts are never collapsed — each one is a separate thing to notice', () => {
  const out = collapseRepeats([
    ev({ kind: 'alert', path: '.env', ts: 2000 }),
    ev({ kind: 'alert', path: '.env', ts: 1900 })
  ] as any)
  assert.equal(out.length, 2)
})

test('a run of repeats does not swallow the next distinct event', () => {
  const out = collapseRepeats([
    fs({ path: 'a.py', ts: 3000 }), fs({ path: 'a.py', ts: 2900 }),
    fs({ path: 'b.py', ts: 2800 }),
    fs({ path: 'a.py', ts: 2700 })
  ] as any)
  assert.deepEqual(out.map(r => [r.path, r.repeat]), [['a.py', 2], ['b.py', undefined], ['a.py', undefined]])
})

test('collapsing never loses an event from the count', () => {
  const rows = Array.from({ length: 20 }, (_, i) =>
    fs({ path: i % 3 === 0 ? 'x.py' : 'y.py', ts: 5000 - i * 50 })) as any
  const total = collapseRepeats(rows).reduce((n, r) => n + (r.repeat ?? 1), 0)
  assert.equal(total, 20)
})

// --- bursts: one action, many files -------------------------------------
const del = (path: string, ts: number) => fs({ kind: 'deleted', path, ts })

test('one command deleting many files collapses to a single directory row', () => {
  const rows = collapseBursts([1, 2, 3, 4, 5].map(i => del(`web/src/ramp${i}.ts`, 5000)) as any)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].burst!.count, 5)
  assert.equal(rows[0].burst!.dir, 'web/src')
  assert.equal(rows[0].burst!.paths.length, 5, 'every path is kept for the detail panel')
})

test('an alert fired by the same burst does not split the run', () => {
  const rows = collapseBursts([
    del('web/src/a.ts', 5000), del('web/src/b.ts', 5000),
    ev({ kind: 'alert', path: 'web/src/c.ts', ts: 5000 }),
    del('web/src/c.ts', 5000), del('web/src/d.ts', 5000)
  ] as any)
  const burst = rows.find(r => r.burst)
  assert.ok(burst, 'the run must survive an interleaved alert')
  assert.equal(burst!.burst!.count, 4)
  assert.ok(rows.some(r => r.kind === 'alert'), 'the alert itself is still shown')
})

test('below the threshold nothing collapses', () => {
  const rows = collapseBursts([del('web/src/a.ts', 5000), del('web/src/b.ts', 5000)] as any)
  assert.equal(rows.length, 2)
  assert.ok(!rows.some(r => r.burst))
})

test('different directories do not merge', () => {
  const rows = collapseBursts([
    del('a/1.ts', 5000), del('a/2.ts', 5000), del('a/3.ts', 5000),
    del('b/1.ts', 5000), del('b/2.ts', 5000), del('b/3.ts', 5000)
  ] as any)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(r => r.burst!.dir), ['a', 'b'])
})

test('different kinds do not merge, even in the same directory at the same instant', () => {
  const rows = collapseBursts([
    del('a/1.ts', 5000), del('a/2.ts', 5000), del('a/3.ts', 5000),
    fs({ kind: 'created', path: 'a/4.ts', ts: 5000 }),
    fs({ kind: 'created', path: 'a/5.ts', ts: 5000 }),
    fs({ kind: 'created', path: 'a/6.ts', ts: 5000 })
  ] as any)
  assert.deepEqual(rows.map(r => r.kind), ['deleted', 'created'])
})

test('events outside the window are not swept into the burst', () => {
  const rows = collapseBursts([
    del('a/1.ts', 9000), del('a/2.ts', 9000), del('a/3.ts', 9000),
    del('a/4.ts', 1000)
  ] as any)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].burst!.count, 3)
  assert.ok(!rows[1].burst)
})

test('tool rows are never swallowed by a burst', () => {
  const rows = collapseBursts([
    del('a/1.ts', 5000), del('a/2.ts', 5000),
    ev({ kind: 'tool', tool: 'Bash', path: null, ts: 5000 }),
    del('a/3.ts', 5000)
  ] as any)
  assert.ok(rows.some(r => r.kind === 'tool'), 'the command that caused the burst stays visible')
})

test('a burst counts events, not rows, when repeats were already collapsed', () => {
  const rows = collapseBursts([
    { ...del('a/1.ts', 5000), repeat: 3 },
    del('a/2.ts', 5000), del('a/3.ts', 5000)
  ] as any)
  assert.equal(rows[0].burst!.count, 5, 'three repeats plus two singles')
})

test('files at the repository root group under an empty directory', () => {
  const rows = collapseBursts([del('a.ts', 5000), del('b.ts', 5000), del('c.ts', 5000)] as any)
  assert.equal(rows[0].burst!.dir, '')
  assert.equal(rows[0].burst!.count, 3)
})

test('no event disappears through both collapse passes', () => {
  const input = Array.from({ length: 30 }, (_, i) => del(`d/f${i}.ts`, 5000 - i * 10)) as any
  const out = collapseBursts(collapseRepeats(input))
  const total = out.reduce((n, r) => n + (r.burst?.count ?? r.repeat ?? 1), 0)
  assert.equal(total, 30)
})

test('a tool description and a prompt use different tones', () => {
  // the description is the bulk of the feed and reads as body copy; a prompt is
  // the operator's own words and keeps the authored colour
  assert.notEqual(TOOL_DESC_TONE, AUTHORED_TONE)
  assert.match(TOOL_DESC_TONE, /zinc/, 'light grey')
  assert.match(AUTHORED_TONE, /lime/, 'neon green')
})

// --- nesting under the containing call -----------------------------------
const call = (id: number, ts: number) => ev({ id, kind: 'tool', tool: 'Bash', path: null, ts, actor: 'claude' })
const during = (id: number, ts: number, parent: number | null, path = 'a.ts') =>
  ev({ id, kind: 'modified', path, ts, actor: parent == null ? 'external' : 'during-claude', duringToolEventId: parent })

test('a change nests under the call that contained it', () => {
  const out = nestByCall([during(2, 2000, 1), call(1, 1000)] as any)
  assert.equal(out.length, 1, 'the child leaves the top level')
  assert.equal(out[0].id, 1)
  assert.equal(out[0].children!.length, 1)
  assert.equal(out[0].children![0].id, 2)
})

test('an unattributed change stays a top-level row', () => {
  const out = nestByCall([during(2, 2000, null), call(1, 1000)] as any)
  assert.equal(out.length, 2)
})

test('a change whose call is not in view stays visible rather than vanishing', () => {
  // the call was filtered out, evicted, or falls outside the loaded window
  const out = nestByCall([during(2, 2000, 999)] as any)
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 2)
})

test('a tool row is never adopted — depth never exceeds 1', () => {
  const a = call(1, 1000); const b = call(2, 2000)
  ;(b as any).duringToolEventId = 1
  const out = nestByCall([b, a] as any)
  assert.equal(out.length, 2)
  assert.ok(out.every(r => !r.children), 'no nesting between calls')
})

test('the top level stays newest-first, so gap dashes keep working', () => {
  const rows = [during(4, 4000, 1), during(3, 3000, 1), call(1, 1000), during(2, 900, null)] as any
  const out = nestByCall(rows)
  const ts = out.map(r => r.ts)
  assert.deepEqual(ts, [...ts].sort((x, y) => y - x), 'still descending')
  // gaps() clamps negatives to 0; a hoisted parent would silently destroy elapsed time
  const g = gaps(ts)
  assert.ok(g.slice(0, -1).every(v => v > 0), 'no zero-clamped gap')
})

test('total elapsed span is conserved by nesting', () => {
  const rows = [during(4, 9000, 1), during(3, 8000, 1), call(1, 1000)] as any
  const out = nestByCall(rows)
  const ts = out.map(r => r.ts)
  const sum = gaps(ts).reduce((a, b) => a + b, 0)
  assert.equal(sum, ts[0] - ts[ts.length - 1])
})

test('children keep newest-first order within a call', () => {
  const out = nestByCall([during(4, 4000, 1), during(3, 3000, 1), call(1, 1000)] as any)
  assert.deepEqual(out[0].children!.map(c => c.id), [4, 3])
})

test('a burst whose members share one call nests; one spanning two does not', () => {
  const shared = { count: 3, dir: 'src', paths: ['src/a', 'src/b', 'src/c'], call: '1' }
  const split = { count: 3, dir: 'src', paths: ['src/a', 'src/b', 'src/c'], call: null }
  assert.equal(nestByCall([{ ...during(2, 2000, 1), burst: shared }, call(1, 1000)] as any).length, 1)
  assert.equal(nestByCall([{ ...during(2, 2000, 1), burst: split }, call(1, 1000)] as any).length, 2)
})

test('collapseRepeats does not merge identical changes from different calls', () => {
  const out = collapseRepeats([during(3, 2000, 7), during(2, 1900, 8)] as any)
  assert.equal(out.length, 2, 'same path and kind, but two different calls')
})

test('the worst measured case — 11 files under one call', () => {
  const kids = Array.from({ length: 11 }, (_, i) => during(100 + i, 5000 - i * 10, 1, `f${i}.ts`))
  const out = nestByCall([...kids, call(1, 1000)] as any)
  assert.equal(out.length, 1)
  assert.equal(out[0].children!.length, 11)
})

test('no event disappears through all three passes', () => {
  const input: any[] = []
  for (let i = 0; i < 40; i++) {
    input.push(during(100 + i, 9000 - i * 40, i % 3 === 0 ? 1 : null, `f${i % 6}.ts`))
  }
  input.push(call(1, 1000))
  const out = nestByCall(collapseBursts(collapseRepeats(input)))
  const total = out.reduce((n, r) =>
    n + (r.burst?.count ?? r.repeat ?? 1) +
    (r.children ?? []).reduce((m, c) => m + (c.burst?.count ?? c.repeat ?? 1), 0), 0)
  assert.equal(total, input.length)
})

test('visibleCount counts children, which the new-events pill depends on', () => {
  const out = nestByCall([during(3, 3000, 1), during(2, 2000, 1), call(1, 1000)] as any)
  assert.equal(out.length, 1, 'top level shrank')
  assert.equal(visibleCount(out), 3, 'but three events are on screen')
})
