import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as db from './db.js'
import * as bus from './bus.js'
import * as rules from './rules.js'

function setup (t, extra = []) {
  bus._reset(); rules._reset()
  const d = mkdtempSync(join(tmpdir(), 'orchr-'))
  t.after(() => { rmSync(d, { recursive: true, force: true }); bus._reset(); rules._reset() })
  const D = db.open(join(d, 'r.db'))
  bus.init(D)
  rules.init(D)
  for (const r of extra) db.addRule(D, r)
  rules.reload()
  const alerts = []
  bus.setMatcher(e => rules.match(e))
  const sink = { on () {}, write (s) { const m = s.match(/^event: append\ndata: (.*)\n\n$/s); if (m) { const e = JSON.parse(m[1]); if (e.kind === 'alert') alerts.push(e) } return true } }
  bus.subscribe('F', sink)
  return { D, alerts }
}

test('three default rules are seeded once and never re-seeded', t => {
  const d = mkdtempSync(join(tmpdir(), 'orchr-')); t.after(() => rmSync(d, { recursive: true, force: true }))
  const p = join(d, 's.db')
  const D = db.open(p); bus.init(D); rules.init(D)
  assert.equal(db.countRules(D), 3)
  rules.init(D)
  assert.equal(db.countRules(D), 3, 'no duplicate seeding')
  for (const r of db.listRules(D)) db.removeRule(D, r.id)
  rules.init(D)
  assert.equal(db.countRules(D), 0, 'deleted defaults must stay deleted')
  bus._reset(); rules._reset()
})

test('a .env change fires exactly one alert', t => {
  const { alerts } = setup(t)
  bus.emit({ folderId: 'F', kind: 'modified', path: '.env', detail: {} })
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].detail.matched, '**/.env*')
})

test('cooldown collapses a storm into one alert, then fires again after it', t => {
  const { alerts } = setup(t)
  for (let i = 0; i < 20; i++) bus.emit({ folderId: 'F', kind: 'modified', path: '.env', detail: {} })
  assert.equal(alerts.length, 1, 'cooldown holds')
  rules._reset() // simulate cooldown expiry
  bus.emit({ folderId: 'F', kind: 'modified', path: '.env', detail: {} })
  assert.equal(alerts.length, 2)
})

test('a rate rule fires only once the threshold is crossed', t => {
  const { alerts } = setup(t)
  for (let i = 0; i < 99; i++) bus.emit({ folderId: 'F', kind: 'modified', path: `f${i}.txt`, detail: {} })
  assert.equal(alerts.length, 0, 'below threshold')
  for (let i = 0; i < 5; i++) bus.emit({ folderId: 'F', kind: 'modified', path: `g${i}.txt`, detail: {} })
  assert.equal(alerts.length, 1, 'fires once, not per event')
})

test('kind-scoped rule ignores other kinds', t => {
  const { alerts } = setup(t)
  bus.emit({ folderId: 'F', kind: 'modified', path: 'src/a.ts', detail: {} })
  assert.equal(alerts.length, 0)
  bus.emit({ folderId: 'F', kind: 'deleted', path: 'src/a.ts', detail: {} })
  assert.equal(alerts.length, 1)
})

test('a folder-scoped rule does not fire for another folder', t => {
  const { D, alerts } = setup(t)
  for (const r of db.listRules(D)) db.removeRule(D, r.id)
  db.addRule(D, { folderId: 'F', kinds: [], pathGlob: '**/*.ts', actions: ['toast'], label: 'x' })
  rules.reload()
  bus.emit({ folderId: 'OTHER', kind: 'modified', path: 'a.ts', detail: {} })
  assert.equal(alerts.length, 0)
  bus.emit({ folderId: 'F', kind: 'modified', path: 'a.ts', detail: {} })
  assert.equal(alerts.length, 1)
})

test('alerts never re-enter the matcher', t => {
  const { alerts } = setup(t)
  bus.emit({ folderId: 'F', kind: 'modified', path: '.env', detail: {} })
  assert.equal(alerts.length, 1, 'no recursion')
})

test('rule evaluation stays under 1ms/event at 500 events', t => {
  const { D } = setup(t)
  for (let i = 0; i < 20; i++) db.addRule(D, { kinds: [], pathGlob: `src/**/*${i}.ts`, actions: ['badge'], label: `r${i}` })
  rules.reload()
  const t0 = performance.now()
  for (let i = 0; i < 500; i++) rules.match({ folderId: 'F', kind: 'modified', path: `src/a/b/f${i}.ts`, ts: Date.now() })
  const per = (performance.now() - t0) / 500
  assert.ok(per < 1, `${per.toFixed(3)}ms per event`)
})
