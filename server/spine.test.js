import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as db from './db.js'
import * as bus from './bus.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'orch-'))
const fresh = t => { const d = tmp(); t.after(() => rmSync(d, { recursive: true, force: true })); return db.open(join(d, 'x.db')) }

test('schema creation is idempotent', t => {
  const d = tmp(); t.after(() => rmSync(d, { recursive: true, force: true }))
  const p = join(d, 'a.db')
  db.open(p); db.open(p)
  assert.deepEqual(db.listFolders(db.open(p)), [])
})

test('every contract kind round-trips with detail intact', t => {
  const D = fresh(t)
  for (const kind of ['created', 'modified', 'deleted', 'renamed', 'tool', 'prompt', 'alert']) {
    const detail = { k: kind, nested: { n: 1 }, arr: [1, 2] }
    db.insertEvent(D, { folderId: 'f1', ts: Date.now(), kind, path: 'a.txt', actor: 'external', detail })
  }
  const rows = db.listEvents(D, { folderId: 'f1' })
  assert.equal(rows.length, 7)
  assert.deepEqual(rows[0].detail.nested, { n: 1 })
})

test('listEvents is newest-first and honours limit and before', t => {
  const D = fresh(t)
  const ids = []
  for (let i = 0; i < 10; i++) ids.push(db.insertEvent(D, { folderId: 'f', ts: 1000 + i, kind: 'modified', path: `${i}.txt` }))
  const top = db.listEvents(D, { folderId: 'f', limit: 3 })
  assert.deepEqual(top.map(e => e.path), ['9.txt', '8.txt', '7.txt'])
  const next = db.listEvents(D, { folderId: 'f', limit: 3, before: top.at(-1).id })
  assert.deepEqual(next.map(e => e.path), ['6.txt', '5.txt', '4.txt'])
})

test('folder CRUD: duplicate rejected, non-directory rejected, nothing inserted', t => {
  const D = fresh(t)
  const f = db.addFolder(D, { path: '/tmp' })
  assert.ok(f.id)
  assert.throws(() => db.addFolder(D, { path: '/tmp' }), e => e.code === 'DUPLICATE')
  assert.throws(() => db.addFolder(D, { path: '/nope-nope' }), e => e.code === 'ENOTDIR_OR_MISSING')
  const file = join(tmp(), 'f.txt'); writeFileSync(file, 'x')
  assert.throws(() => db.addFolder(D, { path: file }), e => e.code === 'ENOTDIR_OR_MISSING')
  assert.equal(db.listFolders(D).length, 1)
  assert.ok(db.removeFolder(D, f.id))
  assert.equal(db.listFolders(D).length, 0)
})

test('retention deletes 31-day-old and keeps 29-day-old', t => {
  const D = fresh(t)
  const now = 1_700_000_000_000
  db.insertEvent(D, { folderId: 'f', ts: now - 31 * 86400000, kind: 'modified', path: 'old' })
  db.insertEvent(D, { folderId: 'f', ts: now - 29 * 86400000, kind: 'modified', path: 'new' })
  assert.equal(db.sweepRetention(D, 30, now), 1)
  assert.deepEqual(db.listEvents(D, { folderId: 'f' }).map(e => e.path), ['new'])
})

const sink = () => { const o = { out: [], on () {}, write (s) { o.out.push(s); return true } }; return o }

test('bus fans out to both subscribers and isolates folders', t => {
  bus._reset()
  const D = fresh(t); bus.init(D)
  const a = sink(); const b = sink(); const other = sink()
  bus.subscribe('f1', a); bus.subscribe('f1', b); bus.subscribe('f2', other)
  bus.emit({ folderId: 'f1', kind: 'modified', path: 'x.txt', actor: 'external', detail: {} })
  assert.equal(a.out.length, 1)
  assert.equal(b.out.length, 1)
  assert.equal(other.out.length, 0, 'folder isolation')
  assert.match(a.out[0], /^event: append\ndata: \{/)
  bus._reset()
})

test('a throwing subscriber is dropped and the rest still receive', t => {
  bus._reset()
  const D = fresh(t); bus.init(D)
  const dead = { on () {}, write () { throw new Error('EPIPE') } }
  const live = sink()
  bus.subscribe('f', dead); bus.subscribe('f', live)
  bus.emit({ folderId: 'f', kind: 'modified', path: 'a', detail: {} })
  assert.equal(bus.size('f'), 1)
  assert.equal(live.out.length, 1)
  bus._reset()
})

test('insert failure still fans out — liveness beats history', t => {
  bus._reset()
  bus.init({ prepare () { throw new Error('disk full') } })
  const s = sink(); bus.subscribe('f', s)
  bus.emit({ folderId: 'f', kind: 'modified', path: 'a', detail: {} })
  assert.equal(s.out.length, 1)
  bus._reset()
})

test('removing the last subscriber leaves no empty set behind', t => {
  bus._reset()
  const D = fresh(t); bus.init(D)
  let onClose
  const s = { on (_e, fn) { onClose = fn }, write () { return true } }
  bus.subscribe('f', s)
  assert.equal(bus.size('f'), 1)
  onClose()
  assert.equal(bus.size('f'), 0)
  assert.equal(bus.hasSubs('f'), false)
  bus._reset()
})

test('a restart closes tool calls left running, without claiming they succeeded', t => {
  const D = fresh(t)
  const live = db.insertEvent(D, { folderId: 'f', ts: Date.now(), kind: 'tool', tool: 'Bash', detail: { state: 'running', toolUseId: 'a' } })
  const done = db.insertEvent(D, { folderId: 'f', ts: Date.now(), kind: 'tool', tool: 'Bash', detail: { state: 'done', durationMs: 12 } })
  assert.equal(db.closeOrphanedRunning(D), 1)
  const rows = db.listEvents(D, { folderId: 'f' })
  const byId = Object.fromEntries(rows.map(r => [r.id, r.detail]))
  assert.equal(byId[live].state, 'unknown', 'we cannot know how it ended')
  assert.equal(byId[live].toolUseId, 'a', 'the rest of the detail survives')
  assert.equal(byId[done].state, 'done', 'a finished call is untouched')
  assert.equal(byId[done].durationMs, 12)
})
