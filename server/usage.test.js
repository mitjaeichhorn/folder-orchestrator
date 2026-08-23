import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as db from './db.js'
import { parseLine } from './transcripts.js'

const fresh = t => {
  const d = mkdtempSync(join(tmpdir(), 'orchu-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  return db.open(join(d, 'u.db'))
}

const assistant = (id, usage, ts = '2026-08-23T10:00:00.000Z', sid = 'U1') => JSON.stringify({
  type: 'assistant', timestamp: ts, sessionId: sid,
  message: { id, content: [], usage }
})

test('usage is read off an assistant record', () => {
  const r = parseLine(assistant('m1', {
    input_tokens: 5, output_tokens: 900, cache_read_input_tokens: 431417,
    cache_creation_input_tokens: 298, output_tokens_details: { thinking_tokens: 173 }
  }), 'F')
  assert.equal(r.usage.inputTokens, 5)
  assert.equal(r.usage.outputTokens, 900)
  assert.equal(r.usage.thinkingTokens, 173)
  assert.equal(r.usage.cacheRead, 431417)
  assert.equal(r.usage.cacheCreation, 298)
  assert.equal(r.usage.messageId, 'm1')
})

test('a record with no usage block yields no usage, not zeros', () => {
  const r = parseLine(assistant('m2', undefined), 'F')
  assert.ok(!r.usage, 'absent usage must not be recorded as a zero-token turn')
})

test('missing usage fields default to zero rather than NaN', () => {
  const r = parseLine(assistant('m3', { output_tokens: 10 }), 'F')
  assert.equal(r.usage.inputTokens, 0)
  assert.equal(r.usage.thinkingTokens, 0)
  assert.equal(r.usage.cacheRead, 0)
})

test('the same message inserted twice is counted once', t => {
  const D = fresh(t)
  const row = { folderId: 'F', ts: 1, messageId: 'dup', outputTokens: 100 }
  assert.equal(db.insertUsage(D, row), true)
  assert.equal(db.insertUsage(D, row), false, 're-reading a transcript must not double-count')
  assert.equal(db.usageByTopic(D, 'F')[0].outputTokens, 100)
})

test('rows with no message id are still recorded', t => {
  const D = fresh(t)
  db.insertUsage(D, { folderId: 'F', ts: 1, outputTokens: 7 })
  db.insertUsage(D, { folderId: 'F', ts: 2, outputTokens: 9 })
  assert.equal(db.usageByTopic(D, 'F')[0].outputTokens, 16)
})

test('usage aggregates per topic, biggest first', t => {
  const D = fresh(t)
  db.insertUsage(D, { folderId: 'F', ts: 1, topic: 'small task', messageId: 'a', outputTokens: 10 })
  db.insertUsage(D, { folderId: 'F', ts: 2, topic: 'big task', messageId: 'b', outputTokens: 900 })
  db.insertUsage(D, { folderId: 'F', ts: 3, topic: 'big task', messageId: 'c', outputTokens: 100, cacheRead: 5 })
  const rows = db.usageByTopic(D, 'F')
  assert.deepEqual(rows.map(r => r.topic), ['big task', 'small task'])
  assert.equal(rows[0].outputTokens, 1000)
  assert.equal(rows[0].messages, 2)
  assert.equal(rows[0].cacheRead, 5)
  assert.equal(rows[0].firstTs, 2)
  assert.equal(rows[0].lastTs, 3)
})

test('usage is scoped to its folder', t => {
  const D = fresh(t)
  db.insertUsage(D, { folderId: 'A', ts: 1, messageId: 'a', outputTokens: 10 })
  db.insertUsage(D, { folderId: 'B', ts: 1, messageId: 'b', outputTokens: 99 })
  assert.equal(db.usageByTopic(D, 'A')[0].outputTokens, 10)
  assert.equal(db.usageByTopic(D, 'B')[0].outputTokens, 99)
})

test('turns before the first prompt group under an empty topic, not under a guess', t => {
  const D = fresh(t)
  db.insertUsage(D, { folderId: 'F', ts: 1, topic: null, messageId: 'a', outputTokens: 5 })
  assert.equal(db.usageByTopic(D, 'F')[0].topic, '')
})

test('re-reading corrects a topic without disturbing the token counts', t => {
  const D = fresh(t)
  db.insertUsage(D, { folderId: 'F', ts: 1, messageId: 'm', topic: 'wrong topic', outputTokens: 500 })
  db.insertUsage(D, { folderId: 'F', ts: 1, messageId: 'm', topic: 'right topic', outputTokens: 500 })
  const rows = db.usageByTopic(D, 'F')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].topic, 'right topic', 'a better attribution wins')
  assert.equal(rows[0].outputTokens, 500, 'but the tokens are still counted once')
  assert.equal(rows[0].messages, 1)
})
