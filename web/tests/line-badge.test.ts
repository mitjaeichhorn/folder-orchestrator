import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lineIndex, showsLineBadge, inDefaultLongFilter, lineTone, LINE_TIER_ORANGE, LINE_TIER_YELLOW, lineIconTone
} from '../src/features/shared/lines.ts'
import { LINE_ALERT_AT, isExecutablePath } from '../../shared/glob.js'

test('the index carries only files we actually measured', () => {
  const m = lineIndex([
    { p: 'a.ts', l: 1200 },
    { p: 'b.py', l: 2000 },
    { p: 'c.md' },                       // never measured
    { p: 'd.bin' }                       // binary, declined
  ])
  assert.deepEqual([...m.keys()].sort(), ['a.ts', 'b.py'])
  assert.equal(m.get('a.ts'), 1200)
  assert.equal(m.get('c.md'), undefined, 'absent means not judged, never zero')
})

test('a null tree yields an empty index rather than throwing', () => {
  assert.equal(lineIndex(null).size, 0)
})

test('the badge is one rule everywhere, python included', () => {
  // Measured live: every long file present in the feed was .py, so exempting
  // python here left the feed, By topic and the detail panel permanently blank.
  assert.equal(showsLineBadge(1200), true)
  assert.equal(showsLineBadge(3119), true)
})

test('a file at or under the threshold never badges', () => {
  assert.equal(showsLineBadge(LINE_ALERT_AT), false, 'the rule is strictly over')
  assert.equal(showsLineBadge(LINE_ALERT_AT + 1), true)
  assert.equal(showsLineBadge(undefined), false)
})

test('the exemption lives in the FILTER, not the badge', () => {
  assert.equal(inDefaultLongFilter('a.ts', 1200), true)
  assert.equal(inDefaultLongFilter('a.py', 3119), false, 'python is not in the default filter')
  assert.equal(inDefaultLongFilter('a.md', 5000), false)
  // ...and the executables filter is where python is asked about
  assert.equal(isExecutablePath('a.py'), true)
})

test('length tiers step at the stated thresholds, and are strictly over', () => {
  assert.match(lineTone(1500), /text-muted-foreground/)
  assert.match(lineTone(LINE_TIER_ORANGE), /text-muted-foreground/, '2000 exactly is not yet orange')
  assert.match(lineTone(LINE_TIER_ORANGE + 1), /text-orange-400/)
  assert.match(lineTone(LINE_TIER_YELLOW), /text-orange-400/, '3000 exactly is not yet yellow')
  assert.match(lineTone(LINE_TIER_YELLOW + 1), /text-yellow-400/)
})

test('every tier is a colour, never an opacity', () => {
  // gradient.ts records why: element opacity fades the badge border and any
  // row treatment underneath it, not just the text.
  for (const n of [1500, 2500, 6314]) {
    assert.doesNotMatch(lineTone(n), /opacity-/, String(n))
  }
})

test('the tiers order hot-to-cold the way this app reads heat', () => {
  // white -> yellow -> orange -> grey. Yellow outranks orange here, which is the
  // reverse of a traffic light and matches the heat ramp instead.
  assert.notEqual(lineTone(6314), lineTone(2500))
  assert.notEqual(lineTone(2500), lineTone(1500))
})

test('the tree icon is never muted — an alert you cannot see is not an alert', () => {
  // lineTone's base tier is fine on a pill that carries the number; as a 10px
  // glyph it measured oklch(0.708 0 0) against the tree and vanished. Most
  // flagged files sit in that base tier: 130 over 1,000 against far fewer above.
  for (const n of [1001, 1199, 2500, 6314]) {
    assert.doesNotMatch(lineIconTone(n), /muted|zinc|slate|neutral/, String(n))
  }
})

test('the icon keeps the same three-step ranking as the pill', () => {
  assert.notEqual(lineIconTone(1500), lineIconTone(2500))
  assert.notEqual(lineIconTone(2500), lineIconTone(6314))
  assert.equal(lineIconTone(LINE_TIER_ORANGE), lineIconTone(1001), 'boundary is strictly over')
  assert.match(lineIconTone(LINE_TIER_ORANGE + 1), /orange/)
  assert.match(lineIconTone(LINE_TIER_YELLOW + 1), /yellow/)
})
