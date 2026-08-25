import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alertVars } from '../src/features/propositions/alert-text.ts'
import { detectAlerts, CHURN_MIN } from '../src/features/propositions/alerts.ts'

const w = (id: number, ts: number, path: string, s = 's1') =>
  ({ id, ts, kind: 'modified', path, sessionId: s })

test('churn leads with the write count, collision leads with the LENGTH', () => {
  const churn = detectAlerts(Array.from({ length: CHURN_MIN }, (_, i) => w(i + 1, i * 1000, 'src/a.ts')))[0]
  assert.equal(alertVars(churn).n, CHURN_MIN)

  const collision = detectAlerts(
    [w(1, 0, 'src/api.ts', 'aaaa'), w(2, 3000, 'src/api.ts', 'bbbb')],
    new Map([['src/api.ts', 6243]])
  )[0]
  assert.equal(alertVars(collision).n, 6243, 'not the write count')
  assert.equal(alertVars(collision).s, 3)
})

test('every alert supplies a path, so no prompt can render an empty target', () => {
  const churn = detectAlerts(Array.from({ length: CHURN_MIN }, (_, i) => w(i + 1, i * 1000, 'src/a.ts')))[0]
  assert.equal(alertVars(churn).path, 'src/a.ts')
})

test('a missing evidence field renders as 0, never as undefined', () => {
  const fake = { key: 'k', kind: 'churn', path: 'p', anchorId: 1, anchorTs: 1, evidence: {} } as never
  const v = alertVars(fake)
  for (const k of ['n', 'm', 's']) assert.equal(v[k], 0, k)
})
