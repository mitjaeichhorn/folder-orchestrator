import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as db from './db.js'
import * as bus from './bus.js'
import {
  init, noteFsEvent, closeToolCall, _openCall, _reset, _recent
} from './transcripts.js'

const F = 'F'

/** A fresh db + a bus sink that records the patch frames the client would see. */
function setup (t) {
  const d = mkdtempSync(join(tmpdir(), 'orchc-'))
  t.after(() => { rmSync(d, { recursive: true, force: true }); bus._reset(); _reset(F) })
  const D = db.open(join(d, 'c.db'))
  bus._reset(); _reset(F)
  bus.init(D); init(D)
  const patches = []
  bus.subscribe(F, {
    on () {},
    write (s) {
      const m = s.match(/^event: patch\ndata: (.*)\n\n$/s)
      if (m) patches.push(JSON.parse(m[1]))
      return true
    }
  })
  const fsEvent = ts => db.insertEvent(D, { folderId: F, ts, kind: 'modified', path: 'a.ts', actor: 'external' })
  const actorOf = id => db.listEvents(D, { folderId: F }).find(e => e.id === id)?.actor
  const rowOf = id => db.listEvents(D, { folderId: F }).find(e => e.id === id)
  return { D, patches, fsEvent, actorOf, rowOf }
}

test('a change while a call is running is labelled when the call closes', t => {
  const { patches, fsEvent, rowOf } = setup(t)
  _openCall(F, 'tu1', 900, 1000, 'S1', 'a topic')
  const id = fsEvent(1500)
  noteFsEvent(F, id, '/abs/a.ts', 1500)
  closeToolCall(F, { toolUseId: 'tu1', ts: 3000 })
  const row = rowOf(id)
  assert.equal(row.actor, 'during-claude')
  assert.equal(row.duringToolEventId, 900)
  assert.equal(row.sessionId, 'S1')
  assert.equal(patches.filter(p => p.id === id).length, 1)
})

test('a change just after a call ends is caught by the grace window', t => {
  const { fsEvent, rowOf } = setup(t)
  _openCall(F, 'tu1', 900, 1000, 'S1')
  closeToolCall(F, { toolUseId: 'tu1', ts: 2000 })
  const id = fsEvent(3500)             // 1.5s after the end, inside the 2s grace
  noteFsEvent(F, id, '/abs/a.ts', 3500)
  assert.equal(rowOf(id).actor, 'during-claude')
})

test('a change past the grace window stays external', t => {
  const { fsEvent, actorOf } = setup(t)
  _openCall(F, 'tu1', 900, 1000, 'S1')
  closeToolCall(F, { toolUseId: 'tu1', ts: 2000 })
  const id = fsEvent(2000 + 2000 + 500)
  noteFsEvent(F, id, '/abs/a.ts', 2000 + 2500)
  assert.equal(actorOf(id), 'external')
})

test('a change before the call started stays external', t => {
  const { fsEvent, actorOf } = setup(t)
  _openCall(F, 'tu1', 900, 5000, 'S1')
  const id = fsEvent(4000)
  noteFsEvent(F, id, '/abs/a.ts', 4000)
  closeToolCall(F, { toolUseId: 'tu1', ts: 6000 })
  assert.equal(actorOf(id), 'external')
})

test('a long call still labels its changes — they must not be evicted first', t => {
  // regression: RECENT_TTL is 30s, and a test suite run easily exceeds it. This
  // fails against the old prune, which evicted by wall time alone.
  const { fsEvent, rowOf } = setup(t)
  const start = 1_000_000
  _openCall(F, 'tu1', 900, start, 'S1')
  const id = fsEvent(start + 1000)
  noteFsEvent(F, id, '/abs/a.ts', start + 1000)
  // 90s of unrelated churn while the call is still open
  for (let i = 1; i <= 90; i++) {
    const other = fsEvent(start + 1000 + i * 1000)
    noteFsEvent(F, other, `/abs/other${i}.ts`, start + 1000 + i * 1000)
  }
  assert.ok(_recent(F).some(r => r.id === id), 'the change must still be in the window')
  closeToolCall(F, { toolUseId: 'tu1', ts: start + 120_000 })
  assert.equal(rowOf(id).actor, 'during-claude')
})

test('two overlapping calls label the row but refuse to name a parent', t => {
  const { fsEvent, rowOf } = setup(t)
  _openCall(F, 'tu1', 901, 1000, 'S1')
  _openCall(F, 'tu2', 902, 1100, 'S1')
  const id = fsEvent(1500)
  noteFsEvent(F, id, '/abs/a.ts', 1500)
  closeToolCall(F, { toolUseId: 'tu1', ts: 3000 })   // tu2 is still open
  const row = rowOf(id)
  assert.equal(row.actor, 'during-claude', 'a call WAS running — that is a fact')
  assert.equal(row.duringToolEventId, null, 'but which one is a guess, so no parent')
})

test('the path join outranks containment, whichever runs first', t => {
  const { D, fsEvent, rowOf } = setup(t)
  // containment first, then the join
  _openCall(F, 'tu1', 900, 1000, 'S1')
  const a = fsEvent(1500)
  noteFsEvent(F, a, '/abs/a.ts', 1500)
  closeToolCall(F, { toolUseId: 'tu1', ts: 3000 })
  assert.equal(rowOf(a).actor, 'during-claude')
  db.relabelEvent(D, a, { actor: 'claude', sessionId: 'S1', topic: null })
  assert.equal(rowOf(a).actor, 'claude', 'the join upgrades it')

  // join first, then containment must refuse to downgrade
  _openCall(F, 'tu2', 910, 5000, 'S1')
  const b = fsEvent(5500)
  db.relabelEvent(D, b, { actor: 'claude', sessionId: 'S1', topic: null })
  noteFsEvent(F, b, '/abs/b.ts', 5500)
  closeToolCall(F, { toolUseId: 'tu2', ts: 7000 })
  assert.equal(rowOf(b).actor, 'claude', 'containment never downgrades an attributed row')
})

test('sweeping twice produces exactly one patch frame', t => {
  const { patches, fsEvent } = setup(t)
  _openCall(F, 'tu1', 900, 1000, 'S1')
  const id = fsEvent(1500)
  noteFsEvent(F, id, '/abs/a.ts', 1500)
  closeToolCall(F, { toolUseId: 'tu1', ts: 3000 })
  // the closed window is still around, so a re-note would try again
  noteFsEvent(F, id, '/abs/a.ts', 1500)
  assert.equal(patches.filter(p => p.id === id && p.actor === 'during-claude').length, 1)
})

test('a call that never closes labels nothing', t => {
  const { fsEvent, actorOf } = setup(t)
  _openCall(F, 'tu1', 900, 1000, 'S1')
  const id = fsEvent(1500)
  noteFsEvent(F, id, '/abs/a.ts', 1500)
  assert.equal(actorOf(id), 'external', 'an unbounded interval contains nothing')
})

test('a rate-ceiling summary row is never labelled', t => {
  const { D, rowOf } = setup(t)
  _openCall(F, 'tu1', 900, 1000, 'S1')
  const id = db.insertEvent(D, { folderId: F, ts: 1500, kind: 'modified', path: null, actor: 'unknown', detail: { collapsed: 40 } })
  noteFsEvent(F, id, '/abs/whatever', 1500)
  closeToolCall(F, { toolUseId: 'tu1', ts: 3000 })
  assert.equal(rowOf(id).actor, 'unknown', 'a summary for N unidentified changes claims nothing')
})

test('old rows without the column read as null and do not throw', t => {
  const d = mkdtempSync(join(tmpdir(), 'orchm-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  const p = join(d, 'old.db')
  const D1 = db.open(p)
  const id = db.insertEvent(D1, { folderId: F, ts: 1, kind: 'modified', path: 'a.ts', actor: 'external' })
  const D2 = db.open(p)                       // re-open runs migrate() again
  const row = db.listEvents(D2, { folderId: F }).find(e => e.id === id)
  assert.equal(row.duringToolEventId, null)
})
