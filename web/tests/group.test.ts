import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupByFile, groupByTopic, NO_FILE, NO_TOPIC, touchedByClaude, newestEventByPath } from '../src/features/files/group-by-file.ts'

const ev = (o: any) => ({ id: Math.random(), folderId: 'F', ts: 1000, kind: 'modified', path: 'a.ts', actor: 'external', sessionId: null, tool: null, detail: {}, ...o })

test('events group under the file they name', () => {
  const g = groupByFile([
    ev({ path: 'a.ts', ts: 1 }),
    ev({ path: 'b.ts', ts: 2 }),
    ev({ path: 'a.ts', ts: 3, kind: 'tool', tool: 'Edit', actor: 'claude' })
  ] as any)
  assert.equal(g.length, 2)
  assert.equal(g[0].path, 'a.ts', 'most recent file first')
  assert.equal(g[0].events.length, 2)
  assert.equal(g[0].changes, 1)
  assert.equal(g[0].claudeActions, 1)
})

test('Bash and other pathless tools go to NO_FILE, never guessed onto a file', () => {
  const g = groupByFile([
    ev({ path: 'a.ts', ts: 1000, kind: 'modified' }),
    ev({ path: null, ts: 1001, kind: 'tool', tool: 'Bash', actor: 'claude' })
  ] as any)
  const file = g.find(x => x.path === 'a.ts')!
  const nofile = g.find(x => x.path === NO_FILE)!
  assert.equal(file.events.length, 1, 'the Bash call must NOT be adopted by the file it nearly touched')
  assert.equal(nofile.events.length, 1)
})

test('NO_FILE always sorts last, however recent', () => {
  const g = groupByFile([
    ev({ path: 'old.ts', ts: 1 }),
    ev({ path: null, ts: 99999, kind: 'tool', tool: 'Bash' })
  ] as any)
  assert.equal(g.at(-1)!.path, NO_FILE)
})

test('child events are newest-first within a group', () => {
  const g = groupByFile([
    ev({ path: 'a.ts', ts: 1 }), ev({ path: 'a.ts', ts: 5 }), ev({ path: 'a.ts', ts: 3 })
  ] as any)
  assert.deepEqual(g[0].events.map(e => e.ts), [5, 3, 1])
})

test('touchedByClaude reflects actual actors, not inference', () => {
  const [claude] = groupByFile([ev({ path: 'a.ts', actor: 'claude' })] as any)
  const [ext] = groupByFile([ev({ path: 'b.ts', actor: 'external' })] as any)
  assert.equal(touchedByClaude(claude), true)
  assert.equal(touchedByClaude(ext), false)
})

test('no event is lost during grouping', () => {
  const events = Array.from({ length: 50 }, (_, i) =>
    ev({ path: i % 7 === 0 ? null : `f${i % 5}.ts`, ts: i })) as any
  const total = groupByFile(events).reduce((n, g) => n + g.events.length, 0)
  assert.equal(total, 50)
})

// --- topic grouping ------------------------------------------------------
test('files nest inside their topic', () => {
  const g = groupByTopic([
    ev({ topic: 'build the watcher', path: 'watcher.js', ts: 10 }),
    ev({ topic: 'build the watcher', path: 'watcher.js', ts: 11, kind: 'tool', tool: 'Edit', actor: 'claude' }),
    ev({ topic: 'build the watcher', path: 'ignore.js', ts: 12 }),
    ev({ topic: 'fix the feed', path: 'Feed.tsx', ts: 20 })
  ] as any)
  assert.equal(g.length, 2)
  assert.equal(g[0].topic, 'fix the feed', 'most recent topic first')
  const watcher = g.find(x => x.topic === 'build the watcher')!
  assert.deepEqual(watcher.files.map(f => f.path), ['ignore.js', 'watcher.js'])
  assert.equal(watcher.files.find(f => f.path === 'watcher.js')!.events.length, 2)
})

test('pathless actions sit under their topic in the no-file bucket', () => {
  const g = groupByTopic([
    ev({ topic: 'build', path: 'a.ts', ts: 1 }),
    ev({ topic: 'build', path: null, ts: 2, kind: 'tool', tool: 'Bash', actor: 'claude' })
  ] as any)
  assert.equal(g[0].files.length, 2)
  assert.equal(g[0].files.at(-1)!.path, NO_FILE, 'no-file bucket sorts last within the topic')
  assert.equal(g[0].files.at(-1)!.events.length, 1)
})

test('events with no topic get their own group, never folded into a neighbour', () => {
  const g = groupByTopic([
    ev({ topic: 'build', ts: 100, path: 'a.ts' }),
    ev({ topic: null, ts: 101, path: 'b.ts' })
  ] as any)
  assert.equal(g.length, 2)
  assert.equal(g.at(-1)!.topic, NO_TOPIC, 'unknown topic sorts last however recent')
  assert.equal(g.find(x => x.topic === 'build')!.events, 1)
})

test('the topic key is the verbatim prompt — grouping never normalises it', () => {
  const raw = 'create clear epics and task based on htdocs/__claude_setup description'
  const g = groupByTopic([ev({ topic: raw, path: 'a.ts' })] as any)
  assert.equal(g[0].topic, raw)
})

test('no event is lost through two levels of grouping', () => {
  const events = Array.from({ length: 60 }, (_, i) => ev({
    topic: i % 3 === 0 ? null : `topic ${i % 4}`,
    path: i % 7 === 0 ? null : `f${i % 5}.ts`,
    ts: i
  })) as any
  const total = groupByTopic(events)
    .reduce((n, t) => n + t.files.reduce((m, f) => m + f.events.length, 0), 0)
  assert.equal(total, 60)
})

test('newestEventByPath picks by timestamp, not by array position', () => {
  // The stream arrives oldest-first; the feed reverses it. A "first match wins"
  // rule would be right for one caller and silently wrong for the other.
  const oldest = { id: 1, ts: 100, path: 'a.ts', kind: 'modified' }
  const newest = { id: 2, ts: 300, path: 'a.ts', kind: 'deleted' }
  const middle = { id: 3, ts: 200, path: 'a.ts', kind: 'modified' }
  for (const order of [[oldest, middle, newest], [newest, middle, oldest], [middle, newest, oldest]]) {
    const m = newestEventByPath(order as never)
    assert.equal(m.get('a.ts')?.id, 2, 'same answer whatever the order')
  }
})

test('ties on timestamp break by id, so a second-resolution clock is not a coin flip', () => {
  const a = { id: 7, ts: 500, path: 'x.ts', kind: 'modified' }
  const b = { id: 9, ts: 500, path: 'x.ts', kind: 'modified' }
  assert.equal(newestEventByPath([a, b] as never).get('x.ts')?.id, 9)
  assert.equal(newestEventByPath([b, a] as never).get('x.ts')?.id, 9)
})

test('pathless events are not indexed — a Bash call describes no file', () => {
  const m = newestEventByPath([
    { id: 1, ts: 1, path: null, kind: 'tool', tool: 'Bash' },
    { id: 2, ts: 2, path: 'a.ts', kind: 'modified' }
  ] as never)
  assert.deepEqual([...m.keys()], ['a.ts'])
})

test('a file with no event is absent, which is what keeps it inert in the tree', () => {
  const m = newestEventByPath([{ id: 1, ts: 1, path: 'seen.ts', kind: 'modified' }] as never)
  assert.equal(m.has('never-touched.ts'), false)
  assert.equal(m.has('seen.ts'), true)
})
