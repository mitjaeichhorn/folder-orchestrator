import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile, shouldIgnore, globToRe } from './ignore.js'
import { decide, RENAME_WINDOW } from './normalise.js'
import * as watcher from './watcher.js'
import * as bus from './bus.js'
import * as db from './db.js'

const tmp = t => { const d = mkdtempSync(join(tmpdir(), 'orchw-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d }

// ponytail: poll, never sleep — fs.watch latency varies with machine load.
async function until (fn, ms = 2000) {
  const end = Date.now() + ms
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 20)) }
  return fn()
}

// ---- ignore -------------------------------------------------------------
test('deny-list matches path segments, not substrings', () => {
  const c = compile({ path: '/x', ignore: [] })
  assert.equal(shouldIgnore('node_modules/a/b.js', c), true)
  assert.equal(shouldIgnore('src/node_modules_helper.js', c), false)
  assert.equal(shouldIgnore('a/.git/HEAD', c), true)
  assert.equal(shouldIgnore('src/App.tsx', c), false)
})

test('atomic-save temp files are ignored', () => {
  const c = compile({ path: '/x', ignore: [] })
  assert.equal(shouldIgnore('README.md.tmp.77', c), true, 'editor atomic-write temp')
  assert.equal(shouldIgnore('a.crswap', c), true)
  assert.equal(shouldIgnore('web/tests/.!2248!timeline.test.ts', c), true, 'editor atomic-write artifact')
  assert.equal(shouldIgnore('web/tests/timeline.test.ts', c), false, 'the real file still passes')
  assert.equal(shouldIgnore('README.md', c), false)
})

test('gitignore negation: last match wins', t => {
  const d = tmp(t)
  writeFileSync(join(d, '.gitignore'), 'out/\n!out/keep.txt\n')
  const c = compile({ path: d, ignore: [] })
  assert.equal(shouldIgnore('out/a.js', c), true)
  assert.equal(shouldIgnore('out/keep.txt', c), false)
})

test('unparseable gitignore still leaves the deny-list active', t => {
  const d = tmp(t)
  mkdirSync(join(d, '.gitignore')) // a directory where a file is expected
  const c = compile({ path: d, ignore: [] })
  assert.equal(shouldIgnore('node_modules/x.js', c), true)
})

test('20k path checks under 50ms', () => {
  const c = compile({ path: '/x', ignore: ['*.map'] })
  const paths = Array.from({ length: 20000 }, (_, i) => `src/a/b/c/file${i}.tsx`)
  const t0 = performance.now()
  for (const p of paths) shouldIgnore(p, c)
  const dur = performance.now() - t0
  assert.ok(dur < 50, `${dur.toFixed(1)}ms`)
})

test('globToRe handles **, *, ?', () => {
  assert.match('src/a/b/c.tsx', globToRe('src/**/*.tsx'))
  assert.doesNotMatch('lib/a.tsx', globToRe('src/**/*.tsx'))
  assert.match('.env.local', globToRe('**/.env*'))
})

// ---- normalise ----------------------------------------------------------
test('decide: ENOENT is deleted, unseen is created, seen is modified', () => {
  const seen = new Map(); const pending = new Map()
  const enoent = () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }) }
  const ok = () => ({ size: 1, mtimeMs: 2, ino: 7 })
  assert.equal(decide('/a', 'a', seen, pending, { statFn: ok }).kind, 'created')
  assert.equal(decide('/a', 'a', seen, pending, { statFn: ok }).kind, 'modified')
  assert.equal(decide('/a', 'a', seen, pending, { statFn: enoent }).kind, 'deleted')
})

test('decide: non-ENOENT stat error drops the event', () => {
  const r = decide('/a', 'a', new Map(), new Map(), {
    statFn: () => { throw Object.assign(new Error('x'), { code: 'EACCES' }) }
  })
  assert.equal(r, null)
})

test('a slow delete/create pair is still recognised as a rename', () => {
  // the delivery gap that made this flake under load
  const ok = () => ({ size: 1, mtimeMs: 2, ino: 42 })
  const enoent = () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }) }
  let now = 1000
  const seen = new Map([['old.txt', 42]]); const pending = new Map()
  decide('/old.txt', 'old.txt', seen, pending, { statFn: enoent, now: () => now })
  now += 300
  assert.equal(decide('/new.txt', 'new.txt', seen, pending, { statFn: ok, now: () => now }).kind, 'renamed')
})

test('rename collapses inside the window, by inode, and not outside it', () => {
  const ok = () => ({ size: 1, mtimeMs: 2, ino: 42 })
  const enoent = () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }) }
  let now = 1000
  const seen = new Map([['old.txt', 42]]); const pending = new Map()
  decide('/old.txt', 'old.txt', seen, pending, { statFn: enoent, now: () => now })
  now += 50
  const r = decide('/new.txt', 'new.txt', seen, pending, { statFn: ok, now: () => now })
  assert.equal(r.kind, 'renamed')
  assert.equal(r.detail.oldPath, 'old.txt')

  // outside the window: two independent events
  const seen2 = new Map([['old.txt', 42]]); const pending2 = new Map()
  now = 1000
  decide('/old.txt', 'old.txt', seen2, pending2, { statFn: enoent, now: () => now })
  now += RENAME_WINDOW + 400
  assert.equal(decide('/new.txt', 'new.txt', seen2, pending2, { statFn: ok, now: () => now }).kind, 'created')

  // a different inode inside the window is NOT a rename
  const seen3 = new Map([['old.txt', 42]]); const pending3 = new Map()
  now = 1000
  decide('/old.txt', 'old.txt', seen3, pending3, { statFn: enoent, now: () => now })
  now += 20
  assert.equal(decide('/other.txt', 'other.txt', seen3, pending3,
    { statFn: () => ({ size: 1, mtimeMs: 2, ino: 99 }), now: () => now }).kind, 'created')
})

// ---- watcher (real fs.watch) -------------------------------------------
function harness (t) {
  bus._reset()
  const d = tmp(t)
  const dbdir = tmp(t)
  const D = db.open(join(dbdir, 'w.db'))
  bus.init(D)
  const got = []
  const sink = { on () {}, write (s) { const m = s.match(/^event: append\ndata: (.*)\n\n$/s); if (m) got.push(JSON.parse(m[1])) ; return true } }
  const folder = { id: 'F', path: d, ignore: [], enabled: true }
  bus.subscribe('F', sink)
  t.after(() => { watcher.stopWatch('F'); bus._reset() })
  return { dir: d, got, folder }
}

test('deep create in a directory made after watch start', async t => {
  const h = harness(t)
  watcher.startWatch(h.folder)
  mkdirSync(join(h.dir, 'a/b/c/d'), { recursive: true })
  writeFileSync(join(h.dir, 'a/b/c/d/deep.txt'), 'x')
  await until(() => h.got.some(e => e.path === 'a/b/c/d/deep.txt' && e.kind === 'created'))
  const hits = h.got.filter(e => e.path === 'a/b/c/d/deep.txt')
  assert.equal(hits.length, 1, JSON.stringify(h.got.map(e => [e.kind, e.path])))
  assert.equal(hits[0].kind, 'created')
  assert.equal(hits[0].actor, 'external')
})

test('delete yields deleted with no trailing modified', async t => {
  const h = harness(t)
  writeFileSync(join(h.dir, 'gone.txt'), 'x')
  watcher.startWatch(h.folder)
  unlinkSync(join(h.dir, 'gone.txt'))
  await until(() => h.got.some(e => e.path === 'gone.txt' && e.kind === 'deleted'))
  assert.deepEqual(h.got.filter(e => e.path === 'gone.txt').map(e => e.kind), ['deleted'])
})

test('rename produces one renamed event carrying oldPath', async t => {
  const h = harness(t)
  writeFileSync(join(h.dir, 'old.txt'), 'x')
  watcher.startWatch(h.folder)
  renameSync(join(h.dir, 'old.txt'), join(h.dir, 'new.txt'))
  const ev = await until(() => h.got.find(e => e.kind === 'renamed'))
  assert.ok(ev, JSON.stringify(h.got.map(e => [e.kind, e.path])))
  assert.equal(ev.path, 'new.txt')
  assert.equal(ev.detail.oldPath, 'old.txt')
})

test('debounce timer collapses a burst and empties its map', () => {
  // Deterministic half: the debounce contract itself, no filesystem involved.
  const fired = []
  const timers = new Map()
  const push = key => {
    clearTimeout(timers.get(key))
    timers.set(key, setTimeout(() => { timers.delete(key); fired.push(key) }, 50))
  }
  for (let i = 0; i < 10; i++) push('busy.txt')
  assert.equal(timers.size, 1, 'one in-flight timer, not ten')
  return new Promise(r => setTimeout(() => {
    assert.deepEqual(fired, ['busy.txt'])
    assert.equal(timers.size, 0, 'timer map empties after firing')
    r()
  }, 120))
})

test('rapid writes collapse well below one event per write', async t => {
  // ponytail: the honest bound. FSEvents batches delivery, so a burst can straddle
  // the 50ms window and yield 2 events rather than 1. Asserting exactly 1 is a
  // flaky test, not a stronger guarantee — the real contract is "collapses".
  const h = harness(t)
  writeFileSync(join(h.dir, 'busy.txt'), '0')
  watcher.startWatch(h.folder)
  for (let i = 0; i < 10; i++) writeFileSync(join(h.dir, 'busy.txt'), String(i))
  await until(() => h.got.some(e => e.path === 'busy.txt'))
  await new Promise(r => setTimeout(r, 300))
  const n = h.got.filter(e => e.path === 'busy.txt').length
  assert.ok(n >= 1 && n <= 2, `expected 1-2 collapsed events, got ${n}`)
})

test('ignored paths produce zero events', async t => {
  const h = harness(t)
  watcher.startWatch(h.folder)
  mkdirSync(join(h.dir, 'node_modules/pkg'), { recursive: true })
  for (let i = 0; i < 50; i++) writeFileSync(join(h.dir, `node_modules/pkg/f${i}.js`), 'x')
  writeFileSync(join(h.dir, 'real.txt'), 'x')
  await until(() => h.got.some(e => e.path === 'real.txt'))
  await new Promise(r => setTimeout(r, 200))
  assert.equal(h.got.filter(e => e.path?.includes('node_modules')).length, 0)
})

test('stopWatch is idempotent and releases state', async t => {
  const h = harness(t)
  watcher.startWatch(h.folder)
  assert.equal(watcher.stopWatch('F'), true)
  assert.equal(watcher.stopWatch('F'), false)
  assert.equal(watcher.status('F').watching, false)
})

test('initial walk skips ignored subtrees', t => {
  const h = harness(t)
  mkdirSync(join(h.dir, 'node_modules/deep/deeper'), { recursive: true })
  for (let i = 0; i < 30; i++) writeFileSync(join(h.dir, `node_modules/deep/deeper/f${i}.js`), 'x')
  writeFileSync(join(h.dir, 'a.txt'), 'x')
  const st = watcher.startWatch(h.folder)
  assert.equal(st.fileCount, 1, 'only a.txt counted')
})
