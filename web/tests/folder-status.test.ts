import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * The sidebar merge. Extracted as data because the bug was not in the fetch —
 * it was that nothing re-read the status at all, so every row showed whatever
 * the rate happened to be when the tab opened.
 */
type F = { id: string; name: string; status?: { eventsPerMin: number; watching: boolean } }

const mergeStatus = (prev: F[], fresh: F[]): F[] => {
  const byId = new Map(fresh.map(f => [f.id, f.status]))
  return prev.map(p => (byId.has(p.id) ? { ...p, status: byId.get(p.id) } : p))
}

test('a busy folder stops reading idle once status is refreshed', () => {
  const prev = [{ id: 'a', name: 'ecommerce', status: { eventsPerMin: 0, watching: true } }]
  const fresh = [{ id: 'a', name: 'ecommerce', status: { eventsPerMin: 42, watching: true } }]
  assert.equal(mergeStatus(prev, fresh)[0].status?.eventsPerMin, 42)
})

test('the merge touches status only — never the list or its order', () => {
  const prev: F[] = [
    { id: 'a', name: 'one', status: { eventsPerMin: 0, watching: true } },
    { id: 'b', name: 'two', status: { eventsPerMin: 0, watching: true } }
  ]
  // the server happens to return them the other way round, and renames one
  const fresh: F[] = [
    { id: 'b', name: 'RENAMED', status: { eventsPerMin: 7, watching: true } },
    { id: 'a', name: 'one', status: { eventsPerMin: 1, watching: true } }
  ]
  const out = mergeStatus(prev, fresh)
  assert.deepEqual(out.map(f => f.id), ['a', 'b'], 'order is the operator\'s, not the response\'s')
  assert.equal(out[1].name, 'two', 'only status is merged, so nothing else can jump under the cursor')
  assert.equal(out[1].status?.eventsPerMin, 7)
})

test('a folder missing from the refresh keeps its last status rather than blanking', () => {
  const prev = [{ id: 'a', name: 'one', status: { eventsPerMin: 5, watching: true } }]
  assert.equal(mergeStatus(prev, [])[0].status?.eventsPerMin, 5)
})

test('zero events per minute is genuinely idle, and not confused with absent', () => {
  const prev = [{ id: 'a', name: 'one', status: { eventsPerMin: 9, watching: true } }]
  const fresh = [{ id: 'a', name: 'one', status: { eventsPerMin: 0, watching: true } }]
  const out = mergeStatus(prev, fresh)
  assert.equal(out[0].status?.eventsPerMin, 0, 'a quietened folder must be allowed to go back to idle')
})
