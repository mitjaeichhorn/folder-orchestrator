import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyHeat, touch, touchAll, heatOf, ancestors, prune, HEAT_SPAN, MIN_HEAT } from '../src/features/heat.ts'

test('ancestors includes every folder above the file, and the file itself', () => {
  assert.deepEqual(ancestors('a/b/c.ts'), ['a', 'a/b', 'a/b/c.ts'])
  assert.deepEqual(ancestors('top.ts'), ['top.ts'])
  assert.deepEqual(ancestors(''), [])
})

test('a touched file is at full heat, and so is every folder containing it', () => {
  const s = touch(emptyHeat(), 'src/lib/a.ts')
  assert.equal(heatOf(s, 'src/lib/a.ts'), 1)
  assert.equal(heatOf(s, 'src/lib'), 1, 'a closed folder must light up for changes inside it')
  assert.equal(heatOf(s, 'src'), 1)
})

test('an untouched path sits at the floor, never invisible', () => {
  const s = touch(emptyHeat(), 'a.ts')
  assert.equal(heatOf(s, 'never/touched.ts'), MIN_HEAT)
  assert.ok(MIN_HEAT > 0, 'the tree must stay readable')
})

test('dimming is caused by OTHER changes, not by elapsed time', () => {
  let s = touch(emptyHeat(), 'a.ts')
  const bright = heatOf(s, 'a.ts')
  // no further events: heat is unchanged no matter how much wall time passes
  assert.equal(heatOf(s, 'a.ts'), bright)
  // one event elsewhere dims it by exactly one step
  s = touch(s, 'b.ts')
  assert.ok(heatOf(s, 'a.ts') < bright)
  assert.equal(heatOf(s, 'b.ts'), 1)
})

test('heat decays linearly over HEAT_SPAN events and then holds at the floor', () => {
  let s = touch(emptyHeat(), 'a.ts')
  for (let i = 0; i < HEAT_SPAN / 2; i++) s = touch(s, `other${i}.ts`)
  assert.ok(Math.abs(heatOf(s, 'a.ts') - 0.5) < 0.02, 'halfway')
  for (let i = 0; i < HEAT_SPAN; i++) s = touch(s, `more${i}.ts`)
  assert.equal(heatOf(s, 'a.ts'), MIN_HEAT, 'floor, not negative')
})

test('re-touching restores full heat', () => {
  let s = touchAll(emptyHeat(), ['a.ts', 'b.ts', 'c.ts', 'd.ts'])
  assert.ok(heatOf(s, 'a.ts') < 1)
  s = touch(s, 'a.ts')
  assert.equal(heatOf(s, 'a.ts'), 1)
})

test('a folder stays hot while any child keeps changing', () => {
  let s = emptyHeat()
  s = touch(s, 'src/a.ts')
  for (let i = 0; i < 10; i++) s = touch(s, `src/f${i}.ts`)
  assert.equal(heatOf(s, 'src'), 1, 'the folder tracks its most recent child')
  assert.ok(heatOf(s, 'src/a.ts') < 1, 'but the specific file has aged')
})

test('touch is immutable — the previous state is unchanged', () => {
  const a = touch(emptyHeat(), 'x.ts')
  const b = touch(a, 'y.ts')
  assert.equal(a.tick, 1)
  assert.equal(b.tick, 2)
  assert.equal(heatOf(a, 'x.ts'), 1, 'the old snapshot still reads as it did')
})

test('a null or empty path is a no-op, not a crash or a wasted tick', () => {
  const s = emptyHeat()
  assert.equal(touch(s, null).tick, 0)
  assert.equal(touch(s, undefined).tick, 0)
  assert.equal(touch(s, '').tick, 0)
})

test('prune keeps the most recent stamps and bounds the map', () => {
  let s = emptyHeat()
  for (let i = 0; i < 100; i++) s = touch(s, `f${i}.ts`)
  const p = prune(s, 10)
  assert.equal(p.stamps.size, 10)
  assert.equal(p.tick, s.tick, 'tick is preserved so ages stay correct')
  assert.ok(p.stamps.has('f99.ts'), 'newest kept')
  assert.ok(!p.stamps.has('f0.ts'), 'oldest dropped')
})

test('backfill order matters: the last event in the list is the brightest', () => {
  const s = touchAll(emptyHeat(), ['old.ts', 'mid.ts', 'new.ts'])
  assert.equal(heatOf(s, 'new.ts'), 1)
  assert.ok(heatOf(s, 'mid.ts') < heatOf(s, 'new.ts'))
  assert.ok(heatOf(s, 'old.ts') < heatOf(s, 'mid.ts'))
})
