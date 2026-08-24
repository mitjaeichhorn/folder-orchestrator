import { test } from 'node:test'
import assert from 'node:assert/strict'
import { laneRows, openGaps } from '../src/features/lane-layout.ts'

const ev = (ts: number, path: string | null, id = ts) => ({ id, ts, path, kind: 'modified' })

test('a pathless event becomes a full-width spine row', () => {
  const rows = laneRows([{ id: 1, ts: 10, path: null, kind: 'tool', tool: 'Bash' }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].spine?.tool, 'Bash')
  assert.deepEqual(rows[0].cells, {})
})

test('events at the same instant in different lanes share one row', () => {
  const rows = laneRows([ev(100, 'server/a.js'), ev(100, 'web/tests/a.test.ts')])
  assert.equal(rows.length, 1, 'one row, two lanes')
  assert.equal(rows[0].cells.work?.ev.path, 'server/a.js')
  assert.equal(rows[0].cells.test?.ev.path, 'web/tests/a.test.ts')
})

test('two files in ONE lane at the same instant collapse into a counted tile', () => {
  // The watcher stamps ts at debounce flush, so one operation writes one
  // timestamp. Two tiles 0ms apart would be inventing two events.
  const rows = laneRows([ev(100, 'server/a.js'), ev(100, 'server/b.js'), ev(100, 'server/c.js')])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].cells.work?.count, 3)
  assert.deepEqual(rows[0].cells.work?.paths, ['server/a.js', 'server/b.js', 'server/c.js'])
})

test('the gap is measured per lane, not per row', () => {
  const rows = laneRows([
    ev(0, 'server/a.js'),          // work
    ev(1000, 'server/b.js'),       // work, 1s later
    ev(5000, 'web/tests/x.test.ts')// test, first in its lane
  ])
  assert.equal(rows[0].cells.work?.gapMs, null, "a lane's first tile has no predecessor")
  assert.equal(rows[1].cells.work?.gapMs, 1000)
  assert.equal(rows[2].cells.test?.gapMs, null, 'test measures from its own lane, not from work')
})

test('a lane gap spans intervening rows in other lanes', () => {
  const rows = laneRows([
    ev(0, 'server/a.js'),
    ev(1000, 'docs/plan.md'),
    ev(2000, 'docs/plan2.md'),
    ev(9000, 'server/b.js')
  ])
  const work = rows[3].cells.work
  assert.equal(work?.gapMs, 9000, 'work waited 9s even though planning was busy meanwhile')
  assert.equal(rows[2].cells.planning?.gapMs, 1000)
})

test('spine rows do not reset a lane gap', () => {
  const rows = laneRows([
    ev(0, 'server/a.js'),
    { id: 2, ts: 3000, path: null, kind: 'tool', tool: 'Bash' },
    ev(8000, 'server/b.js')
  ])
  assert.equal(rows[1].spine?.tool, 'Bash')
  assert.equal(rows[2].cells.work?.gapMs, 8000, 'the wait crossed a spine band and continued')
})

test('every event survives the layout — nothing is dropped', () => {
  const input = [
    ev(0, 'server/a.js'), ev(0, 'server/b.js'), ev(0, 'docs/x.md'),
    { id: 9, ts: 5, path: null, kind: 'tool', tool: 'Bash' },
    ev(10, 'web/tests/y.test.ts')
  ]
  const rows = laneRows(input)
  const counted = rows.reduce((n, r) =>
    n + (r.spine ? 1 : 0) + Object.values(r.cells).reduce((m, c) => m + (c?.count ?? 0), 0), 0)
  assert.equal(counted, input.length)
})

test('open gaps report silence per lane, and nothing for a lane never used', () => {
  const g = openGaps([ev(1000, 'server/a.js'), ev(2000, 'docs/p.md')], 62000)
  assert.equal(g.work, 61000)
  assert.equal(g.planning, 60000)
  assert.equal(g.test, undefined, 'no elapsed time since an event that never happened')
})

test('an open gap is never negative if the clock lags the newest event', () => {
  const g = openGaps([ev(9000, 'server/a.js')], 8000)
  assert.equal(g.work, 0)
})
