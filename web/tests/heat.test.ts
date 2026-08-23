import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyHeat, touch, touchAll, heatOf, ancestors, prune, justChanged, stampOf, hasHeat, HEAT_SPAN, MIN_HEAT } from '../src/features/heat.ts'
import { pruneToActive, activeFolders, shouldPulse } from '../src/features/prune-tree.ts'
import { heatColor, heatStyle } from '../src/features/heat-color.ts'
import { chainOf, revealPredicate, isOpenWith, LOCATE_HUE, LOCATE_ICON_TONE, LOCATE_CHAIN_CLASS, LOCATE_TARGET_CLASS } from '../src/features/locate.ts'

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

// --- flash ---------------------------------------------------------------
test('only the exact changed path flashes, never its ancestors', () => {
  let s = touch(emptyHeat(), 'src/lib/a.ts')
  assert.equal(justChanged(s, 'src/lib/a.ts'), true)
  assert.equal(justChanged(s, 'src/lib'), false, 'a parent did not change, its child did')
  assert.equal(justChanged(s, 'src'), false)
  assert.equal(justChanged(s, 'other.ts'), false)

  s = touch(s, 'other.ts')
  assert.equal(justChanged(s, 'src/lib/a.ts'), false, 'the previous flash is over')
  assert.equal(justChanged(s, 'other.ts'), true)
})

test('a changed FOLDER flashes itself — it is the thing that changed', () => {
  const s = touch(emptyHeat(), 'src/newdir')
  assert.equal(justChanged(s, 'src/newdir'), true)
  assert.equal(justChanged(s, 'src'), false)
})

test('ancestors still brighten even though they do not flash', () => {
  const s = touch(emptyHeat(), 'src/lib/a.ts')
  assert.equal(heatOf(s, 'src/lib'), 1, 'a closed folder must still light up')
  assert.equal(justChanged(s, 'src/lib'), false, 'but it must not flash')
})

test('prune keeps the flash target', () => {
  let s = emptyHeat()
  for (let i = 0; i < 50; i++) s = touch(s, `f${i}.ts`)
  const p = prune(s, 5)
  assert.equal(justChanged(p, 'f49.ts'), true)
})

test('nothing is just-changed before any event', () => {
  assert.equal(justChanged(emptyHeat(), 'a.ts'), false)
})

test('stampOf reports the tick, or null for an untouched path', () => {
  const s = touch(emptyHeat(), 'a.ts')
  assert.equal(stampOf(s, 'a.ts'), 1)
  assert.equal(stampOf(s, 'b.ts'), null)
})

test('the stamp changes on every touch so a re-touch can restart the flash', () => {
  let s = touch(emptyHeat(), 'a.ts')
  const first = stampOf(s, 'a.ts')
  s = touch(s, 'b.ts')
  s = touch(s, 'a.ts')
  assert.notEqual(stampOf(s, 'a.ts'), first, 'a new stamp is what remounts the node')
})

// --- active-only view ----------------------------------------------------
const TREE: any = [
  { n: 'src', p: 'src', d: 1, c: [
    { n: 'lib', p: 'src/lib', d: 1, c: [{ n: 'a.ts', p: 'src/lib/a.ts', d: 0 }] },
    { n: 'cold.ts', p: 'src/cold.ts', d: 0 }
  ] },
  { n: 'docs', p: 'docs', d: 1, c: [{ n: 'x.md', p: 'docs/x.md', d: 0 }] },
  { n: 'top.ts', p: 'top.ts', d: 0 }
]

test('pruning to active keeps the whole route down to a changed file', () => {
  const s = touch(emptyHeat(), 'src/lib/a.ts')
  const kept = pruneToActive(TREE, p => hasHeat(s, p))
  assert.deepEqual(kept.map((n: any) => n.p), ['src'])
  assert.deepEqual(kept[0].c.map((n: any) => n.p), ['src/lib'], 'the untouched sibling file is dropped')
  assert.deepEqual(kept[0].c[0].c.map((n: any) => n.p), ['src/lib/a.ts'])
})

test('an untouched tree prunes to nothing rather than to everything', () => {
  assert.deepEqual(pruneToActive(TREE, p => hasHeat(emptyHeat(), p)), [])
})

test('a touched top-level file survives pruning', () => {
  const s = touch(emptyHeat(), 'top.ts')
  assert.deepEqual(pruneToActive(TREE, p => hasHeat(s, p)).map((n: any) => n.p), ['top.ts'])
})

test('activeFolders lists only folders, and only touched ones', () => {
  let s = touch(emptyHeat(), 'src/lib/a.ts')
  s = touch(s, 'docs/x.md')
  const folders = activeFolders(TREE, p => hasHeat(s, p))
  assert.deepEqual(folders.sort(), ['docs', 'src', 'src/lib'])
  assert.ok(!folders.includes('src/lib/a.ts'), 'files are not folders')
})

test('hasHeat is about being touched at all, not about being recent', () => {
  let s = touch(emptyHeat(), 'a.ts')
  for (let i = 0; i < HEAT_SPAN * 2; i++) s = touch(s, `other${i}.ts`)
  assert.equal(heatOf(s, 'a.ts'), MIN_HEAT, 'fully dimmed')
  assert.equal(hasHeat(s, 'a.ts'), true, 'but still active — it did change in this session')
})

// --- heat ramp -----------------------------------------------------------
test('the hottest branch is white and the coldest is the muted token', () => {
  assert.equal(heatColor(1), '#ffffff')
  assert.equal(heatColor(0), 'var(--color-muted-foreground)')
})

test('the ramp passes through yellow then orange on the way down', () => {
  assert.equal(heatColor(0.7), '#fde047', 'yellow stop')
  assert.equal(heatColor(0.4), '#fb923c', 'orange stop')
  assert.match(heatColor(0.85), /#ffffff.*#fde047/, 'white to yellow')
  assert.match(heatColor(0.55), /#fde047.*#fb923c/, 'yellow to orange')
  assert.match(heatColor(0.2), /#fb923c.*muted-foreground/, 'orange fading to grey')
})

test('every mix is a valid oklab color-mix', () => {
  for (let h = 0; h <= 1.0001; h += 0.05) {
    const c = heatColor(h)
    assert.ok(c.startsWith('#') || c.startsWith('var(') || /^color-mix\(in oklab, .+ \d+%, .+\)$/.test(c), `${h}: ${c}`)
  }
})

test('out-of-range and non-finite heat clamps instead of producing garbage', () => {
  assert.equal(heatColor(5), '#ffffff')
  assert.equal(heatColor(-1), 'var(--color-muted-foreground)')
  assert.equal(heatColor(NaN), 'var(--color-muted-foreground)')
})

test('heat is carried by colour alone, never opacity', () => {
  // element opacity also fades the background, which silently weakened the
  // locate highlight on exactly the cold branches it exists to reveal
  for (const h of [0, 0.5, 1]) {
    assert.deepEqual(Object.keys(heatStyle(h)), ['color'])
  }
})

// --- pulse scope ---------------------------------------------------------
test('a file being edited pulses', () => {
  assert.equal(shouldPulse({ p: 'src/a.ts', d: 0 }, new Set(['src/a.ts'])), true)
})

test('a directory never pulses, even when its own path is in the running set', () => {
  // mkdir/rmdir emit an event whose path IS the directory, which would
  // otherwise light up the entire branch
  assert.equal(shouldPulse({ p: 'src/burst', d: 1 }, new Set(['src/burst'])), false)
})

test('an ancestor of an edited file does not pulse', () => {
  const running = new Set(['src/lib/a.ts'])
  assert.equal(shouldPulse({ p: 'src', d: 1 }, running), false)
  assert.equal(shouldPulse({ p: 'src/lib', d: 1 }, running), false)
  assert.equal(shouldPulse({ p: 'src/lib/a.ts', d: 0 }, running), true)
})

test('nothing pulses when nothing is running', () => {
  assert.equal(shouldPulse({ p: 'a.ts', d: 0 }, undefined), false)
  assert.equal(shouldPulse({ p: 'a.ts', d: 0 }, new Set()), false)
})

// --- hover-to-locate -----------------------------------------------------
test('the chain is the file and every folder above it', () => {
  assert.deepEqual([...chainOf('a/b/c.ts')], ancestors('a/b/c.ts'))
})

test('no hover yields an empty, referentially stable chain', () => {
  assert.equal(chainOf(null).size, 0)
  assert.equal(chainOf(null), chainOf(undefined), 'same object, so no needless re-render')
})

test('an empty chain leaves Active only behaving exactly as before', () => {
  const isActive = (p: string) => p.startsWith('hot')
  const widened = revealPredicate(isActive, chainOf(null))
  for (const p of ['hot/a.ts', 'cold/b.ts', 'hot', 'cold']) {
    assert.equal(widened(p), isActive(p), p)
  }
})

test('hovering reveals a completely cold branch, and only that branch', () => {
  const s = touch(emptyHeat(), 'hot/x.ts')
  const isActive = (p: string) => hasHeat(s, p)
  const kept = pruneToActive(TREE, revealPredicate(isActive, chainOf('src/lib/a.ts')))
  const paths: string[] = []
  const walk = (ns: any[]) => ns.forEach((n: any) => { paths.push(n.p); if (n.c) walk(n.c) })
  walk(kept)
  assert.ok(paths.includes('src/lib/a.ts'), 'the hovered file is revealed')
  assert.ok(paths.includes('src') && paths.includes('src/lib'), 'and the route to it')
  assert.ok(!paths.includes('src/cold.ts'), 'but not its untouched sibling')
  assert.ok(!paths.includes('docs'), 'nor an unrelated cold branch')
})

test('a collapsed folder on the chain renders open, others stay closed', () => {
  const closed = new Set(['src', 'docs'])
  const chain = chainOf('src/lib/a.ts')
  assert.equal(isOpenWith(closed, chain, 'src'), true, 'on the chain — opened')
  assert.equal(isOpenWith(closed, chain, 'docs'), false, 'off the chain — untouched')
  assert.equal(isOpenWith(closed, chainOf(null), 'src'), false, 'no hover — still closed')
})

test('the override never mutates the collapse state, so restore cannot be missed', () => {
  const closed = new Set(['src'])
  const before = new Set(closed)
  const chain = chainOf('src/lib/a.ts')
  isOpenWith(closed, chain, 'src')
  pruneToActive(TREE, revealPredicate(() => false, chain))
  assert.equal(closed.size, before.size)
  assert.deepEqual([...closed], [...before], 'same contents, same Set')
})

test('both overrides compose: collapsed AND filtered out is still revealed', () => {
  const closed = new Set(['src', 'src/lib'])
  const chain = chainOf('src/lib/a.ts')
  const kept = pruneToActive(TREE, revealPredicate(() => false, chain))
  assert.equal(kept.length, 1, 'nothing is active, yet the chain survives')
  assert.equal(isOpenWith(closed, chain, 'src/lib'), true)
})

test('the locate icon and the branch it lights share one hue', () => {
  // two independently chosen blues would drift the moment either is touched
  for (const c of [LOCATE_ICON_TONE, LOCATE_CHAIN_CLASS, LOCATE_TARGET_CLASS]) {
    assert.ok(c.includes(LOCATE_HUE), `${c} must use ${LOCATE_HUE}`)
  }
})

test('the locate blue is not primary, which is near-white in this theme', () => {
  for (const c of [LOCATE_ICON_TONE, LOCATE_CHAIN_CLASS, LOCATE_TARGET_CLASS]) {
    assert.ok(!c.includes('primary'), c)
  }
})

test('the locate blue does not collide with the churn ramp', async () => {
  const { CHURN_STOPS } = await import('../src/features/churn.ts')
  assert.ok(!CHURN_STOPS.some(s => s.color.includes(LOCATE_HUE)),
    'a By-file bar and a locate highlight must stay distinct')
})

test('the target is emphasised more than the rest of its chain', () => {
  assert.ok(LOCATE_TARGET_CLASS.includes('ring'), 'the file itself gets a ring')
  assert.ok(!LOCATE_CHAIN_CLASS.includes('ring'), 'its ancestors do not')
})
