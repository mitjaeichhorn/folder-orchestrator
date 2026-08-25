import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gapPx, gaps, fmtGap, isCapped, isRunning, runningFor, isStalled, runningPaths, runningSince, MAX_GAP_PX, PX_PER_SECOND, CAP_SECONDS, RUNNING_CAP_MS } from '../src/features/shared/timeline.ts'

test('one second of elapsed time is one unit of dash', () => {
  assert.equal(gapPx(1000), PX_PER_SECOND)
  assert.equal(gapPx(10_000), 10 * PX_PER_SECOND)
})

test('height is capped so a long pause cannot blow up the page', () => {
  assert.equal(gapPx(2 * 3600 * 1000), MAX_GAP_PX)
  assert.equal(gapPx(Number.MAX_SAFE_INTEGER), MAX_GAP_PX)
})

test('zero, negative and non-finite gaps draw nothing rather than throwing', () => {
  for (const v of [0, -5000, NaN, Infinity, -Infinity]) assert.equal(gapPx(v), 0)
})

test('a capped gap is flagged so the UI can label the real duration', () => {
  assert.equal(isCapped((CAP_SECONDS + 1) * 1000), true)
  assert.equal(isCapped((CAP_SECONDS - 1) * 1000), false)
  assert.equal(isCapped(NaN), false)
})

test('gaps are measured against the older neighbour in a newest-first list', () => {
  // 12:00:30, 12:00:20, 12:00:00
  assert.deepEqual(gaps([30_000, 20_000, 0]), [10_000, 20_000, 0])
})

test('the oldest visible row has no gap', () => {
  assert.deepEqual(gaps([5000]), [0])
  assert.deepEqual(gaps([]), [])
})

test('out-of-order timestamps clamp to zero instead of drawing upward', () => {
  assert.deepEqual(gaps([1000, 5000]), [0, 0])
})

test('duration labels are compact and unit-suffixed', () => {
  assert.equal(fmtGap(3000), '3s')
  assert.equal(fmtGap(59_000), '59s')
  assert.equal(fmtGap(120_000), '2m')
  assert.equal(fmtGap(3_600_000), '1h')
  assert.equal(fmtGap(5_400_000), '1h 30m')
  assert.equal(fmtGap(0), '')
})

// --- in-flight tool calls ------------------------------------------------
test('a running tool call is identified by its state, not by a missing duration', () => {
  assert.equal(isRunning({ kind: 'tool', detail: { state: 'running' } }), true)
  assert.equal(isRunning({ kind: 'tool', detail: { state: 'done', durationMs: 5 } }), false)
  assert.equal(isRunning({ kind: 'tool', detail: {} }), false, 'no state means an old row, not a live one')
  assert.equal(isRunning({ kind: 'modified', detail: { state: 'running' } }), false)
  assert.equal(isRunning(null as any), false)
})

test('elapsed time grows with the clock and is bounded', () => {
  assert.equal(runningFor(1000, 4000), 3000)
  assert.equal(runningFor(1000, 1000), 0)
  assert.equal(runningFor(1000, 500), 0, 'clock skew must not go negative')
  assert.equal(runningFor(0, 60 * 60 * 1000), RUNNING_CAP_MS, 'a stuck call is capped')
})

test('a call past the cap is reported as stalled', () => {
  assert.equal(isStalled(0, RUNNING_CAP_MS - 1), false)
  assert.equal(isStalled(0, RUNNING_CAP_MS + 1), true)
})

// --- running paths -------------------------------------------------------
test('a finished call contributes nothing, a live one contributes its named file', () => {
  const now = Date.now()
  const set = runningPaths([
    { kind: 'tool', path: 'a.ts', ts: now, detail: { state: 'running' } },
    { kind: 'tool', path: 'b.ts', ts: now, detail: { state: 'done', durationMs: 5 } }
  ], now)
  assert.deepEqual([...set], ['a.ts'], 'b.ts finished, so it is not in-flight work')
})

test('with nothing in flight, a named path from a finished call is not marked', () => {
  const now = Date.now()
  const set = runningPaths([
    { kind: 'tool', path: 'b.ts', ts: now, detail: { state: 'done', durationMs: 5 } },
    { kind: 'modified', path: 'c.ts', ts: now }
  ], now)
  assert.equal(set.size, 0)
})

test('a Bash call in flight pulses nothing in the tree — it named no file', () => {
  assert.equal(runningPaths([{ kind: 'tool', path: null, detail: { state: 'running' } }]).size, 0)
})

test('the same file running twice appears once', () => {
  const now = Date.now()
  const set = runningPaths([
    { kind: 'tool', path: 'a.ts', ts: now, detail: { state: 'running' } },
    { kind: 'tool', path: 'a.ts', ts: now, detail: { state: 'running' } }
  ], now)
  assert.equal(set.size, 1)
})

test('an empty or finished list yields an empty set, never undefined', () => {
  assert.equal(runningPaths([]).size, 0)
  assert.equal(runningPaths([{ kind: 'tool', path: 'a.ts', detail: {} }]).size, 0)
})

test('files changed while a command is in flight are marked as active work', () => {
  // explicit clock: without one these timestamps read as stalled
  const set = runningPaths([
    { kind: 'tool', path: null, ts: 1000, detail: { state: 'running' } },
    { kind: 'modified', path: 'built.js', ts: 1500 },
    { kind: 'created', path: 'also.js', ts: 2000 }
  ], 2100)
  assert.deepEqual([...set].sort(), ['also.js', 'built.js'])
})

test('files changed BEFORE the running command started are not marked', () => {
  const set = runningPaths([
    { kind: 'tool', path: null, ts: 5000, detail: { state: 'running' } },
    { kind: 'modified', path: 'earlier.js', ts: 4000 }
  ], 5100)
  assert.equal(set.size, 0, 'a change that predates the command is not part of it')
})

test('with nothing running, no file is marked however recent', () => {
  const set = runningPaths([
    { kind: 'tool', path: null, ts: 5000, detail: { state: 'done', durationMs: 1 } },
    { kind: 'modified', path: 'recent.js', ts: 9000 }
  ], 9100)
  assert.equal(set.size, 0)
})

test('the window starts at the OLDEST in-flight call, not the newest', () => {
  assert.equal(runningSince([
    { kind: 'tool', path: null, ts: 5000, detail: { state: 'running' } },
    { kind: 'tool', path: null, ts: 2000, detail: { state: 'running' } }
  ], 5100), 2000)
  assert.equal(runningSince([{ kind: 'tool', path: null, ts: 1, detail: { state: 'done' } }], 100), null)
})

test('alerts and prompts are never marked as files being worked on', () => {
  const set = runningPaths([
    { kind: 'tool', path: null, ts: 1000, detail: { state: 'running' } },
    { kind: 'alert', path: '.env', ts: 1500 },
    { kind: 'prompt', path: null, ts: 1500 }
  ], 1600)
  assert.equal(set.size, 0)
})

test('a call stalled past the cap no longer counts as running work', () => {
  const now = 10_000_000
  const stale = now - (RUNNING_CAP_MS + 60_000)
  assert.equal(runningSince([{ kind: 'tool', path: null, ts: stale, detail: { state: 'running' } }], now), null)
  // and it must not drag the window back so that everything since pulses
  const set = runningPaths([
    { kind: 'tool', path: null, ts: stale, detail: { state: 'running' } },
    { kind: 'modified', path: 'unrelated.js', ts: now - 60_000 }
  ], now)
  assert.equal(set.size, 0)
})

test('a live call still counts even when a stalled one is present', () => {
  const now = 10_000_000
  const set = runningPaths([
    { kind: 'tool', path: null, ts: now - (RUNNING_CAP_MS + 60_000), detail: { state: 'running' } },
    { kind: 'tool', path: null, ts: now - 5_000, detail: { state: 'running' } },
    { kind: 'modified', path: 'live.js', ts: now - 2_000 }
  ], now)
  assert.deepEqual([...set], ['live.js'])
})

test('an unknown state is not running — a restart cannot leave rows animating', () => {
  assert.equal(isRunning({ kind: 'tool', detail: { state: 'unknown' } }), false)
})
