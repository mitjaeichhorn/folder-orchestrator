import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filesByLastChange, maxChanges, churnShare, churnColor, CHURN_STOPS } from '../src/features/churn.ts'
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
