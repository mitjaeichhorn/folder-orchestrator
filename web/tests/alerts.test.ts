import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectAlerts, visibleAlerts, alertsByPath,
  CHURN_MIN, CHURN_WINDOW_MS, STALL_MS
} from '../src/features/propositions/alerts.ts'

const w = (id: number, ts: number, path: string, sessionId = 's1') =>
  ({ id, ts, kind: 'modified', path, sessionId })

test('an executable rewritten past the threshold raises churn', () => {
  const evs = Array.from({ length: CHURN_MIN }, (_, i) => w(i + 1, i * 1000, 'src/a.ts'))
  const [a] = detectAlerts(evs)
  assert.equal(a.kind, 'churn')
  assert.equal(a.path, 'src/a.ts')
  assert.equal(a.evidence.count, CHURN_MIN)
  assert.equal(a.anchorId, CHURN_MIN, 'anchors on the newest write, which is the row it hangs under')
})

test('a log file rewritten far more often raises nothing', () => {
  // Measured: deploy-runs.jsonl hit 166 rewrites. The app under test appends to
  // it by design, and unfiltered this rule is dominated by logs.
  const evs = Array.from({ length: 200 }, (_, i) => w(i + 1, i * 1000, 'logs/deploy-runs.jsonl'))
  assert.deepEqual(detectAlerts(evs), [])
})

test('churn counts only the most recent window, not every historical burst', () => {
  const old = Array.from({ length: CHURN_MIN }, (_, i) => w(i + 1, i * 1000, 'src/a.ts'))
  const gap = CHURN_WINDOW_MS * 3
  const recent = Array.from({ length: 2 }, (_, i) => w(100 + i, gap + i * 1000, 'src/a.ts'))
  assert.deepEqual(detectAlerts([...old, ...recent]), [], 'the old burst has aged out')
})

test('two sessions on a LONG file collide; on a short one they do not', () => {
  const evs = [w(1, 0, 'src/api.ts', 'aaaa'), w(2, 3000, 'src/api.ts', 'bbbb')]
  const long = detectAlerts(evs, new Map([['src/api.ts', 6243]]))
  assert.equal(long.length, 1)
  assert.equal(long[0].kind, 'collision')
  assert.equal(long[0].evidence.seconds, 3)
  assert.deepEqual(long[0].evidence.sessions, ['aaaa', 'bbbb'])

  // a 26-line __init__.py collision is a coordination problem, not a structural
  // one — splitting it would achieve nothing, so it must not fire
  assert.deepEqual(detectAlerts(evs, new Map([['src/api.ts', 26]])), [])
})

test('a file we never measured cannot collide — no length is assumed', () => {
  const evs = [w(1, 0, 'src/api.ts', 'aaaa'), w(2, 3000, 'src/api.ts', 'bbbb')]
  assert.deepEqual(detectAlerts(evs, new Map()), [])
})

test('the same session editing twice is not a collision', () => {
  const evs = [w(1, 0, 'src/api.ts', 'aaaa'), w(2, 3000, 'src/api.ts', 'aaaa')]
  assert.deepEqual(detectAlerts(evs, new Map([['src/api.ts', 6243]])), [])
})

test('snoozing hides an alert until a NEWER event re-triggers it', () => {
  const evs = Array.from({ length: CHURN_MIN }, (_, i) => w(i + 1, i * 1000, 'src/a.ts'))
  const [a] = detectAlerts(evs)
  const snoozed = new Map([[a.key, a.anchorId]])
  assert.deepEqual(visibleAlerts([a], snoozed, new Set()), [], 'quiet at the dismissed anchor')

  const later = detectAlerts([...evs, w(999, 9 * 1000, 'src/a.ts')])[0]
  assert.equal(visibleAlerts([later], snoozed, new Set()).length, 1, 'a newer write brings it back')
})

test('muting hides an alert whatever happens next', () => {
  const evs = Array.from({ length: CHURN_MIN + 5 }, (_, i) => w(i + 1, i * 1000, 'src/a.ts'))
  const [a] = detectAlerts(evs)
  assert.deepEqual(visibleAlerts([a], new Map(), new Set([a.key])), [])
})

test('alerts index by PATH, because the feed collapses rows', () => {
  // collapseRepeats merges consecutive writes to one file, so a churned file's
  // anchor event is exactly the one most likely never to be rendered.
  const evs = Array.from({ length: CHURN_MIN }, (_, i) => w(i + 1, i * 1000, 'src/a.ts'))
  const byPath = alertsByPath(detectAlerts(evs))
  assert.equal(byPath.get('src/a.ts')?.length, 1)
  assert.equal(byPath.get('src/other.ts'), undefined)
})

test('no events, no alerts — and no crash', () => {
  assert.deepEqual(detectAlerts([]), [])
  assert.deepEqual(detectAlerts([], new Map()), [])
})

test('stalled: calls still landing, nothing written for a long time', () => {
  const now = 1_000_000_000
  // an unbroken run: calls every 2 minutes for 8, so no gap exceeds the cutoff
  const evs = [
    { id: 1, ts: now - STALL_MS - 60_000, kind: 'modified', path: 'src/a.ts' },
    ...Array.from({ length: 5 }, (_, i) => ({ id: 10 + i, ts: now - (8 - i * 2) * 60_000, kind: 'tool', tool: 'Bash' }))
  ]
  const hit = detectAlerts(evs as never, undefined, now).find(a => a.kind === 'stalled')
  assert.ok(hit, 'writes stopped but calls did not')
  assert.equal(hit!.evidence.count, 5, 'counts the calls in the current run')
  assert.equal(hit!.path, 'src/a.ts', 'anchors on the last file written')
})

test('idle is not stalled — no calls either means nobody is working', () => {
  // Measured: a project 99 minutes since its last write AND 99 since its last
  // call. Nothing is stuck there; it is simply not in use.
  const now = 1_000_000_000
  const evs = [
    { id: 1, ts: now - 99 * 60_000, kind: 'modified', path: 'src/a.ts' },
    { id: 2, ts: now - 98 * 60_000, kind: 'tool', tool: 'Bash' }
  ]
  assert.equal(detectAlerts(evs as never, undefined, now).find(a => a.kind === 'stalled'), undefined)
})

test('recent writes are never stalled, however many calls are running', () => {
  const now = 1_000_000_000
  const evs = [
    { id: 1, ts: now - 30_000, kind: 'modified', path: 'src/a.ts' },
    ...Array.from({ length: 40 }, (_, i) => ({ id: 10 + i, ts: now - 20_000 + i, kind: 'tool', tool: 'Bash' }))
  ]
  assert.equal(detectAlerts(evs as never, undefined, now).find(a => a.kind === 'stalled'), undefined)
})

test('the stall clock is passed in, never read from the wall', () => {
  // detectAlerts takes `now`, so the same events give the same answer forever.
  const evs = [
    { id: 1, ts: 0, kind: 'modified', path: 'src/a.ts' },
    ...Array.from({ length: 5 }, (_, i) => ({ id: 10 + i, ts: STALL_MS - (8 - i * 2) * 60_000 + 8 * 60_000, kind: 'tool', tool: 'Bash' }))
  ]
  assert.ok(detectAlerts(evs as never, undefined, STALL_MS + 2).find(a => a.kind === 'stalled'))
  assert.equal(detectAlerts(evs as never, undefined, 1).find(a => a.kind === 'stalled'), undefined,
    'the same events, an earlier clock, no alert')
})

test('resuming after a break is not a stall', () => {
  // Replaying real history, the rule reported 759- and 614-minute "stalls".
  // Those were mornings: work restarts with a couple of calls before anything is
  // written. The calls have to SPAN a stretch for the claim to hold.
  const now = 1_000_000_000
  const evs = [
    { id: 1, ts: now - 12 * 60 * 60_000, kind: 'modified', path: 'src/a.ts' },
    { id: 2, ts: now - 60_000, kind: 'tool', tool: 'Bash' },
    { id: 3, ts: now - 30_000, kind: 'tool', tool: 'Bash' }
  ]
  assert.equal(detectAlerts(evs as never, undefined, now).find(a => a.kind === 'stalled'), undefined)
})

test('a stall reports time SPENT working, not time since the last write', () => {
  // Across a break those differ wildly: replaying history, since-last-write
  // claimed 602- and 614-minute stalls where the honest number was minutes.
  const now = 1_000_000_000
  const evs = [
    { id: 1, ts: now - 10 * 60 * 60_000, kind: 'modified', path: 'src/a.ts' },  // last night
    // a call right after that write, then nothing until this morning's run
    { id: 2, ts: now - 10 * 60 * 60_000 + 1000, kind: 'tool', tool: 'Bash' },
    ...Array.from({ length: 5 }, (_, i) => ({ id: 10 + i, ts: now - (8 - i * 2) * 60_000, kind: 'tool', tool: 'Bash' }))
  ]
  const hit = detectAlerts(evs as never, undefined, now).find(a => a.kind === 'stalled')
  assert.ok(hit)
  assert.ok(hit!.evidence.minutes! < 20,
    `reported ${hit!.evidence.minutes} min — the night must not be counted as work`)
})
