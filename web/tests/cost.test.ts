import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isFree, FREE_ROW_CLASS } from '../src/features/cost.ts'
import { ALL_KINDS } from '../../shared/glob.js'

test('filesystem kinds and alerts are free', () => {
  for (const kind of ['created', 'modified', 'deleted', 'renamed', 'alert']) {
    assert.equal(isFree({ kind }), true, `${kind} should be free`)
  }
})

test('Claude turns are billed', () => {
  assert.equal(isFree({ kind: 'tool' }), false)
  assert.equal(isFree({ kind: 'prompt' }), false)
})

test('every known kind is classified, so a new kind cannot slip through unnoticed', () => {
  // ALL_KINDS is the shared list the filter chips are built from. If a kind is
  // added there this asserts someone decided which side of the line it sits on.
  const billed = ALL_KINDS.filter((k: string) => !isFree({ kind: k }))
  assert.deepEqual(billed.sort(), ['prompt', 'tool'])
})

test('the free class mutes with colour, never opacity', () => {
  // gradient.ts records why: element opacity fades the hatch and any highlight
  // layered on the row, not just the text.
  assert.match(FREE_ROW_CLASS, /text-muted-foreground/)
  assert.doesNotMatch(FREE_ROW_CLASS, /opacity-/)
})
