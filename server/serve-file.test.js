import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveInside, isImage, IMAGE_MIME, TEXT_MIME, SERVED_MIME } from './serve-file.js'

const tmp = t => { const d = mkdtempSync(join(tmpdir(), 'orchf-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d }

test('isImage is an allow-list and is case-insensitive', () => {
  assert.equal(isImage('a/b.PNG'), true)
  assert.equal(isImage('shot.jpeg'), true)
  assert.equal(isImage('index.ts'), false)
  assert.equal(isImage('.env'), false)
  assert.equal(isImage(null), false)
  assert.equal(isImage('png'), false, 'extension, not substring')
})

test('a normal file inside the folder resolves', t => {
  const d = tmp(t)
  mkdirSync(join(d, 'sub'))
  writeFileSync(join(d, 'sub', 'a.png'), 'x')
  const r = resolveInside(d, 'sub/a.png')
  assert.equal(r.abs, join(d, 'sub', 'a.png'))
  assert.equal(r.size, 1)
})

test('traversal out of the folder is refused', t => {
  const d = tmp(t)
  writeFileSync(join(d, 'ok.png'), 'x')
  for (const p of ['../secret.png', '../../etc/passwd', 'sub/../../out.png', '/etc/passwd']) {
    assert.throws(() => resolveInside(d, p), e => e.code === 'OUTSIDE' || e.code === 'MISSING', p)
  }
})

test('a folder that is itself under a symlink still serves its files', t => {
  // macOS: /var/folders/... is a symlink to /private/var/folders/...
  // Both sides of the containment check must be realpath'd.
  const d = tmp(t)
  writeFileSync(join(d, 'a.png'), 'x')
  assert.doesNotThrow(() => resolveInside(d, 'a.png'))
})

test('a symlink pointing outside the folder is refused even though it lives inside', t => {
  const d = tmp(t)
  const outside = tmp(t)
  writeFileSync(join(outside, 'secret.png'), 'x')
  symlinkSync(join(outside, 'secret.png'), join(d, 'link.png'))
  assert.throws(() => resolveInside(d, 'link.png'), e => e.code === 'OUTSIDE')
})

test('a directory is not a file', t => {
  const d = tmp(t)
  mkdirSync(join(d, 'adir'))
  assert.throws(() => resolveInside(d, 'adir'), e => e.code === 'NOT_FILE')
})

test('empty, null-byte and non-string paths are refused', t => {
  const d = tmp(t)
  for (const p of ['', null, undefined, 42, 'a\0b']) {
    assert.throws(() => resolveInside(d, p), e => e.code === 'BAD_PATH' || e.code === 'MISSING')
  }
})

test('the image half of the map is still only images', () => {
  for (const mime of Object.values(IMAGE_MIME)) {
    assert.match(mime, /^image\//, mime)
  }
})

test('the text half serves markdown only, and declares its charset', () => {
  // Declared rather than sniffed: a browser guessing the encoding of a file from
  // a watched repo is a decision we should be making, not it.
  for (const mime of Object.values(TEXT_MIME)) {
    assert.match(mime, /^text\/markdown; charset=utf-8$/, mime)
  }
})

test('the served map is exactly the two halves — nothing sneaks in', () => {
  assert.deepEqual(
    Object.keys(SERVED_MIME).sort(),
    [...Object.keys(IMAGE_MIME), ...Object.keys(TEXT_MIME)].sort()
  )
})

test('the allow-list still refuses source, config and secrets', () => {
  // The reason this route is an allow-list at all. Widening it for markdown must
  // not have widened it for anything else.
  for (const ext of ['.ts', '.js', '.json', '.env', '.pem', '.key', '.sh', '.html', '.txt', '']) {
    assert.equal(SERVED_MIME[ext], undefined, `${ext} must not be servable`)
  }
})

test('the shared markdown list and the server text map agree exactly', async () => {
  const { MARKDOWN_EXTS } = await import('../shared/glob.js')
  assert.deepEqual([...MARKDOWN_EXTS].sort(), Object.keys(TEXT_MIME).sort(),
    'client would request a preview the server refuses, or miss one it would serve')
})

test('isMarkdownPath is case-insensitive and does not claim other files', async () => {
  const { isMarkdownPath } = await import('../shared/glob.js')
  for (const ext of Object.keys(TEXT_MIME)) {
    assert.equal(isMarkdownPath(`dir/f${ext}`), true, ext)
    assert.equal(isMarkdownPath(`dir/f${ext.toUpperCase()}`), true, ext)
  }
  for (const p of ['a.ts', 'README', 'a.md.ts', 'notmd', '']) {
    assert.equal(isMarkdownPath(p), false, p)
  }
})

test('the shared image list and the server mime map agree exactly', async () => {
  const { IMAGE_EXTS } = await import('../shared/glob.js')
  const mimeExts = Object.keys(IMAGE_MIME).sort()
  assert.deepEqual([...IMAGE_EXTS].sort(), mimeExts,
    'client would request a thumbnail the server refuses, or miss one it would serve')
})

test('isImagePath agrees with the server isImage for every extension', async () => {
  const { isImagePath } = await import('../shared/glob.js')
  for (const ext of Object.keys(IMAGE_MIME)) {
    assert.equal(isImagePath(`dir/f${ext}`), isImage(`dir/f${ext}`), ext)
    assert.equal(isImagePath(`dir/f${ext.toUpperCase()}`), isImage(`dir/f${ext.toUpperCase()}`), ext)
  }
  assert.equal(isImagePath('a.ts'), false)
})
