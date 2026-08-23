import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pickFolder, CANCELLED, TIMEOUT_MS } from './pick-folder.js'

test('the AppleScript is a fixed constant — no client input can reach it', () => {
  const src = readFileSync(new URL('./pick-folder.js', import.meta.url), 'utf8')
  const script = src.slice(src.indexOf('const SCRIPT'), src.indexOf('export const CANCELLED'))
  assert.doesNotMatch(script, /\$\{/, 'no interpolation into AppleScript')
  assert.match(src, /execFile\('osascript'/, 'execFile, never exec — no shell involved')
  assert.doesNotMatch(src, /\bexec\(/, 'a shell would reintroduce injection')
})

test('a cancel is distinguishable from a pick', () => {
  assert.equal(CANCELLED, '__CANCELLED__')
})

test('the dialog cannot hang the process forever', () => {
  assert.ok(TIMEOUT_MS > 0 && TIMEOUT_MS <= 300000, 'bounded wait')
})

test('a non-darwin host reports unsupported rather than throwing', async t => {
  const real = process.platform
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  t.after(() => Object.defineProperty(process, 'platform', { value: real, configurable: true }))
  const r = await pickFolder()
  assert.deepEqual(r, { error: 'UNSUPPORTED_PLATFORM' })
})
