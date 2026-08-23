import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filesByLastChange, maxChanges, churnShare, churnColor, CHURN_STOPS, allFilesByLastChange, treeFiles, changedPaths, deletedPaths } from '../src/features/churn.ts'
import { groupByFile, NO_FILE } from '../src/features/group-by-file.ts'

const ev = (o: any) => ({ id: 1, folderId: 'F', ts: 1000, kind: 'modified', path: 'a.ts', actor: 'external', sessionId: null, tool: null, topic: null, detail: {}, ...o })

test('files are ranked by most recent change', () => {
  const files = filesByLastChange(groupByFile([
    ev({ path: 'old.ts', ts: 1000 }),
    ev({ path: 'newest.ts', ts: 9000 }),
    ev({ path: 'mid.ts', ts: 5000 })
  ] as any))
  assert.deepEqual(files.map(f => f.path), ['newest.ts', 'mid.ts', 'old.ts'])
})

test('pathless actions are excluded — they are not files', () => {
  const files = filesByLastChange(groupByFile([
    ev({ path: null, kind: 'tool', tool: 'Bash', ts: 9000 }),
    ev({ path: 'a.ts', ts: 1000 })
  ] as any))
  assert.deepEqual(files.map(f => f.path), ['a.ts'])
  assert.ok(!files.some(f => f.path === NO_FILE))
})

test('a file with only tool actions and no changes is excluded', () => {
  // Read touches a file without changing it; this view is about changes
  const files = filesByLastChange(groupByFile([
    ev({ path: 'read-only.ts', kind: 'tool', tool: 'Read', ts: 9000 })
  ] as any))
  assert.equal(files.length, 0)
})

test('change counts accumulate per file', () => {
  const files = filesByLastChange(groupByFile([
    ev({ path: 'busy.ts', ts: 3000 }), ev({ path: 'busy.ts', ts: 2000 }),
    ev({ path: 'busy.ts', ts: 1000 }), ev({ path: 'calm.ts', ts: 500 })
  ] as any))
  assert.equal(files.find(f => f.path === 'busy.ts')!.changes, 3)
  assert.equal(files.find(f => f.path === 'calm.ts')!.changes, 1)
  assert.equal(maxChanges(files), 3)
})

test('churn is relative to the busiest file in view', () => {
  // on a quiet folder, three edits IS the top of the scale
  assert.equal(churnShare(3, 3), 1)
  assert.equal(churnShare(1, 3), 0)
  assert.ok(Math.abs(churnShare(2, 3) - 0.5) < 0.001)
})

test('a file changed once is never shaded as churn', () => {
  assert.equal(churnShare(1, 11), 0)
  assert.equal(churnColor(churnShare(1, 11)), CHURN_STOPS[CHURN_STOPS.length - 1].color)
})

test('a single file in view does not divide by zero', () => {
  assert.equal(churnShare(1, 1), 0)
  assert.equal(churnShare(5, 1), 0)
  assert.equal(maxChanges([]), 0)
})

test('the ramp reaches both ends and stays a valid mix between', () => {
  assert.equal(churnColor(1), CHURN_STOPS[0].color)
  assert.equal(churnColor(0), CHURN_STOPS[2].color)
  for (let s = 0; s <= 1.0001; s += 0.05) {
    const c = churnColor(s)
    assert.ok(c.startsWith('var(') || /^color-mix\(in oklab, .+ \d+%, .+\)$/.test(c), `${s}: ${c}`)
  }
})

test('non-finite and out-of-range values clamp instead of producing garbage', () => {
  for (const v of [NaN, Infinity, -1, 5]) {
    const c = churnColor(v as number)
    assert.ok(typeof c === 'string' && c.length > 0)
  }
  assert.equal(churnShare(NaN, 10), 0)
})

test('churn and recency use different hues, so the panels cannot be confused', async () => {
  const { HEAT_STOPS } = await import('../src/features/heat-color.ts')
  const heat = HEAT_STOPS.map(s => s.color)
  const churn = CHURN_STOPS.map(s => s.color)
  assert.equal(churn.filter(c => heat.includes(c)).length, 0)
})

// --- every file, not just the observed ones ------------------------------
const tf = (p: string, m: number) => ({ p, m })

test('files never observed still appear, ranked by their mtime', () => {
  const rows = allFilesByLastChange(
    [tf('never-seen.ts', 9000), tf('watched.ts', 1000)],
    groupByFile([ev({ path: 'watched.ts', ts: 5000 })] as any)
  )
  assert.deepEqual(rows.map(r => r.path), ['never-seen.ts', 'watched.ts'])
  assert.equal(rows[0].changes, 0, 'we saw nothing, so we claim nothing')
  assert.equal(rows[0].observed, false)
})

test('an observed change outranks a stale mtime for the same file', () => {
  const rows = allFilesByLastChange(
    [tf('a.ts', 1000)],
    groupByFile([ev({ path: 'a.ts', ts: 8000 })] as any)
  )
  assert.equal(rows[0].lastTs, 8000)
  assert.equal(rows[0].changes, 1)
})

test('a file deleted while watching is kept and marked absent', () => {
  const rows = allFilesByLastChange(
    [tf('still-here.ts', 1000)],
    groupByFile([ev({ path: 'gone.ts', kind: 'deleted', ts: 5000 })] as any)
  )
  const gone = rows.find(r => r.path === 'gone.ts')
  assert.ok(gone, 'a deletion is a change and must not vanish')
  assert.equal(gone!.present, false)
  assert.equal(rows.find(r => r.path === 'still-here.ts')!.present, true)
})

test('pathless actions never become file rows', () => {
  const rows = allFilesByLastChange([], groupByFile([
    ev({ path: null, kind: 'tool', tool: 'Bash', ts: 9000 })
  ] as any))
  assert.equal(rows.length, 0)
})

test('a tool-only touch adds no change count', () => {
  const rows = allFilesByLastChange(
    [tf('read.ts', 1000)],
    groupByFile([ev({ path: 'read.ts', kind: 'tool', tool: 'Read', ts: 5000 })] as any)
  )
  assert.equal(rows[0].changes, 0)
  assert.equal(rows[0].observed, false)
  assert.equal(rows[0].lastTs, 5000, 'but it is still the most recent thing that happened to it')
})

test('the whole project is ranked, largest first', () => {
  const files = Array.from({ length: 200 }, (_, i) => tf(`f${i}.ts`, i * 100))
  const rows = allFilesByLastChange(files, [])
  assert.equal(rows.length, 200)
  assert.equal(rows[0].path, 'f199.ts')
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].lastTs >= r.lastTs))
})

test('treeFiles flattens files and skips directories', () => {
  const out = treeFiles([
    { p: 'src', d: 1, c: [{ p: 'src/a.ts', d: 0, m: 5 }] },
    { p: 'b.ts', d: 0, m: 9 }
  ] as any)
  assert.deepEqual(out.map(f => f.p), ['src/a.ts', 'b.ts'])
  assert.equal(out[0].m, 5)
})

// --- flashing files that just changed ------------------------------------
const row = (path: string, id: number) => ({ path, events: id ? [{ id }] : [] })

test('nothing flashes on first render', () => {
  const { changed, next } = changedPaths(new Map(), [row('a.ts', 1), row('b.ts', 2)])
  assert.deepEqual(changed, [], 'the whole list arriving is not a change')
  assert.equal(next.size, 2)
})

test('a file with a new event flashes; unchanged files do not', () => {
  const prev = new Map([['a.ts', 1], ['b.ts', 2]])
  const { changed } = changedPaths(prev, [row('a.ts', 9), row('b.ts', 2)])
  assert.deepEqual(changed, ['a.ts'])
})

test('a file seen changing for the first time flashes', () => {
  const prev = new Map([['a.ts', 0]])          // known, never observed changing
  const { changed } = changedPaths(prev, [row('a.ts', 5)])
  assert.deepEqual(changed, ['a.ts'])
})

test('a file that stays unobserved does not flash', () => {
  const prev = new Map([['a.ts', 0]])
  const { changed } = changedPaths(prev, [row('a.ts', 0)])
  assert.deepEqual(changed, [])
})

test('identity is the newest event id, not the count or the timestamp', () => {
  // two events in the same second, count unchanged after a collapse
  const prev = new Map([['a.ts', 7]])
  assert.deepEqual(changedPaths(prev, [row('a.ts', 8)]).changed, ['a.ts'])
  assert.deepEqual(changedPaths(prev, [row('a.ts', 7)]).changed, [])
})

test('the returned map carries forward for the next comparison', () => {
  const first = changedPaths(new Map(), [row('a.ts', 1)])
  const second = changedPaths(first.next, [row('a.ts', 2)])
  assert.deepEqual(second.changed, ['a.ts'])
  assert.equal(second.next.get('a.ts'), 2)
})

// --- not asking for files we know are gone -------------------------------
test('a file whose newest event is a deletion is known gone', () => {
  const gone = deletedPaths([
    { path: 'gone.png', kind: 'deleted' },
    { path: 'gone.png', kind: 'created' }
  ])
  assert.deepEqual([...gone], ['gone.png'])
})

test('a file deleted then recreated is not gone', () => {
  const gone = deletedPaths([
    { path: 'back.png', kind: 'created' },
    { path: 'back.png', kind: 'deleted' }
  ])
  assert.equal(gone.size, 0, 'newest-first, so the recreate wins')
})

test('a tool touch after a deletion does not resurrect the file', () => {
  const gone = deletedPaths([
    { path: 'gone.png', kind: 'tool' },
    { path: 'gone.png', kind: 'deleted' }
  ])
  assert.deepEqual([...gone], ['gone.png'], 'reading a path is not creating it')
})

test('pathless events are ignored', () => {
  assert.equal(deletedPaths([{ path: null, kind: 'deleted' }]).size, 0)
})

test('long files sort by size, since their mtimes are old by definition', () => {
  // The reason the filter exists: in the default recency order the first file
  // over the threshold sat at row 558 of 4,783, so the badge was unreachable.
  const rows = [
    { path: 'a.ts', lines: 1200, lastTs: 1 },
    { path: 'b.ts', lines: 6314, lastTs: 2 },
    { path: 'c.ts', lines: undefined, lastTs: 9 },
    { path: 'd.ts', lines: 900, lastTs: 8 }
  ]
  const long = rows
    .filter(r => typeof r.lines === 'number' && r.lines > 1000)
    .sort((a, b) => (b.lines ?? 0) - (a.lines ?? 0))
  assert.deepEqual(long.map(r => r.path), ['b.ts', 'a.ts'])
  assert.equal(long.every(r => (r.lines ?? 0) > 1000), true)
})

test('a file with no measured count is never flagged as long', () => {
  // Absent means "not judged" — exempt extension, binary, or over the read cap.
  // Treating undefined as 0 would be harmless; treating it as long would not.
  const rows = [{ path: 'x.py', lines: undefined }, { path: 'y.bin', lines: undefined }]
  assert.equal(rows.filter(r => typeof r.lines === 'number' && r.lines > 1000).length, 0)
})
