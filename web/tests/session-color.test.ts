import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSION_TONES, shortSession, sessionTones, sessionsIn, isMultiSession
} from '../src/features/session-color.ts'

test('three concurrent sessions get three distinct tones', () => {
  // The measured case: three sessions on one project inside an hour.
  const m = sessionTones(['7ee6445c', '2efdb390', '4185828d'])
  assert.equal(new Set(m.values()).size, 3, 'a shared colour is the failure this prevents')
})

test('assignment is by sorted order, so it cannot collide and does not drift', () => {
  const a = sessionTones(['ccc', 'aaa', 'bbb'])
  const b = sessionTones(['bbb', 'ccc', 'aaa'])
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort(),
    'same set of sessions, same colours, whatever order they arrive in')
})

test('the palette avoids every hue that already carries meaning', () => {
  // heat: white/yellow/orange/grey · churn: sky/violet/rose · locate: blue-400
  // tools: violet · lines added: emerald
  const taken = /yellow|orange|sky|violet|rose|blue|emerald|amber|zinc|muted/
  for (const tone of SESSION_TONES) assert.doesNotMatch(tone, taken, tone)
})

test('more sessions than tones wraps rather than throwing', () => {
  const ids = Array.from({ length: SESSION_TONES.length + 2 }, (_, i) => `s${i}`)
  const m = sessionTones(ids)
  assert.equal(m.size, ids.length)
  assert.equal(new Set(m.values()).size, SESSION_TONES.length, 'wraps — documented, not silent')
})

test('sessionsIn ranks by most recent activity, not by first appearance', () => {
  const ids = sessionsIn([
    { sessionId: 'old', ts: 100 },
    { sessionId: 'new', ts: 900 },
    { sessionId: 'old', ts: 200 },
    { sessionId: null, ts: 950 }
  ])
  assert.deepEqual(ids, ['new', 'old'])
})

test('a single session does not earn a chip', () => {
  assert.equal(isMultiSession(['only']), false)
  assert.equal(isMultiSession(['a', 'b']), true)
  assert.equal(isMultiSession([]), false)
})

test('the short label is stable and safe on missing ids', () => {
  assert.equal(shortSession('2efdb390-47a7-4a2a'), '2efd')
  assert.equal(shortSession(null), '')
  assert.equal(shortSession(undefined), '')
  assert.equal(shortSession(''), '')
})
