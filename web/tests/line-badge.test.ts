import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineIndex, showsLineBadge, inDefaultLongFilter } from '../src/features/lines.ts'
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
