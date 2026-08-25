import { test } from 'node:test'
import assert from 'node:assert/strict'
import { folderFromHash, hashForFolder, pickFolder } from '../src/features/folders/url-state.ts'

test('a folder id round-trips through the hash', () => {
  const id = '666b5c54-96ad-4c86-8358-9febe123e770'
  assert.equal(folderFromHash(hashForFolder(id)), id)
})

test('an empty or junk hash yields null rather than a bogus id', () => {
  for (const h of ['', '#', '#other=1', 'not-a-query', '#folder=', '#folder=%20']) {
    const v = folderFromHash(h)
    assert.ok(v === null || v.trim() !== '', h)
  }
  assert.equal(folderFromHash('#folder='), null)
})

test('the hash is read with or without its leading #', () => {
  assert.equal(folderFromHash('folder=abc'), 'abc')
  assert.equal(folderFromHash('#folder=abc'), 'abc')
})

test('a null folder produces an empty hash, not the string "null"', () => {
  assert.equal(hashForFolder(null), '')
})

test('the URL wins when it names a folder that exists', () => {
  const list = [{ id: 'a' }, { id: 'b' }]
  assert.equal(pickFolder(list, 'b', 'a'), 'b')
})

test('a URL naming a folder that no longer exists falls back, it does not blank', () => {
  const list = [{ id: 'a' }, { id: 'b' }]
  assert.equal(pickFolder(list, 'deleted-id', 'b'), 'b', 'then the previous selection')
  assert.equal(pickFolder(list, 'deleted-id', null), 'a', 'then the first folder')
})

test('with no folders at all the answer is null, not a crash', () => {
  assert.equal(pickFolder([], 'x', 'y'), null)
})

test('the previously open folder survives a refresh that has no URL', () => {
  assert.equal(pickFolder([{ id: 'a' }, { id: 'b' }], null, 'b'), 'b')
})
