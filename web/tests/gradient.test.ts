import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeRamp, rampCss, shareOf } from '../src/features/shared/gradient.ts'

const STOPS = [
  { at: 1, color: 'red' },
  { at: 0.5, color: 'orange' },
  { at: 0, color: 'grey' }
] as const

test('the endpoints return their stop verbatim, with no color-mix wrapper', () => {
  const ramp = makeRamp(STOPS)
  assert.equal(ramp(1), 'red', 'fully hot is exactly the colour declared')
  assert.equal(ramp(0), 'grey')
  assert.equal(ramp(0.5), 'orange', 'an interior stop lands exactly too')
})

test('between stops it mixes the two neighbours in oklab', () => {
  const ramp = makeRamp(STOPS)
  assert.match(ramp(0.75), /^color-mix\(in oklab, red 50%, orange\)$/)
  assert.match(ramp(0.25), /^color-mix\(in oklab, orange 50%, grey\)$/)
})

test('it never mixes across a stop it should have stopped at', () => {
  const ramp = makeRamp(STOPS)
  assert.ok(!ramp(0.75).includes('grey'), 'the cold end is not in play up here')
  assert.ok(!ramp(0.25).includes('red'))
})

test('out-of-range and non-finite input clamps instead of emitting NaN%', () => {
  const ramp = makeRamp(STOPS)
  assert.equal(ramp(5), 'red')
  assert.equal(ramp(-3), 'grey')
  for (const v of [NaN, Infinity, -Infinity]) {
    const c = ramp(v as number)
    assert.ok(!c.includes('NaN'), `${v} produced ${c}`)
  }
})

test('every value across the range yields a renderable colour', () => {
  const ramp = makeRamp(STOPS)
  for (let s = 0; s <= 1.0001; s += 0.05) {
    const c = ramp(s)
    assert.ok(/^[a-z]+$/.test(c) || /^color-mix\(in oklab, .+ \d+%, .+\)$/.test(c), `${s}: ${c}`)
  }
})

test('a two-stop ramp works, and a one-stop ramp is constant', () => {
  const two = makeRamp([{ at: 1, color: 'a' }, { at: 0, color: 'b' }])
  assert.equal(two(1), 'a')
  assert.equal(two(0), 'b')
  const one = makeRamp([{ at: 1, color: 'only' }])
  assert.equal(one(1), 'only')
  assert.equal(one(0), 'only')
})

test('rampCss orders stops cold to hot, left to right', () => {
  const css = rampCss(STOPS)
  assert.match(css, /^linear-gradient\(to right, grey 0%, orange 50%, red 100%\)$/)
})

test('shareOf is relative to the largest in view, not an absolute threshold', () => {
  assert.equal(shareOf(3, 3), 1, 'on a quiet folder, three IS the top')
  assert.equal(shareOf(1, 3), 0)
  assert.ok(Math.abs(shareOf(2, 3) - 0.5) < 0.001)
})

test('the floor means nothing to report, not a little', () => {
  assert.equal(shareOf(1, 10), 0, 'one change is the baseline, never shaded')
  assert.equal(shareOf(0, 10), 0)
  assert.equal(shareOf(-5, 10), 0)
})

test('a single item in view does not divide by zero', () => {
  assert.equal(shareOf(1, 1), 0)
  assert.equal(shareOf(9, 1), 0)
  assert.equal(shareOf(NaN, 10), 0)
})
