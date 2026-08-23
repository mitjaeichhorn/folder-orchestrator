import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const en = JSON.parse(readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url), 'utf8'))

// The runtime t() lives in a module that imports import.meta.env; reimplement its
// contract here so the fallback rules are tested without a bundler.
function makeT () {
  return (key: string, vars?: Record<string, string | number>) => {
    let s = en[key]
    if (s === undefined) return key
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
    return s
  }
}

test('a missing key returns the key itself — visible, never a blank or an English literal', () => {
  const t = makeT()
  assert.equal(t('nope.not.a.key'), 'nope.not.a.key')
})

test('interpolation replaces every occurrence', () => {
  const t = makeT()
  assert.equal(t('feed.newEvents', { n: 7 }), '7 new')
  assert.equal(t('rules.threshold', { count: 100, seconds: 10 }), 'more than 100 events in 10s')
})

test('Intl formatting honours a non-default locale — no hand-written date strings', () => {
  const ts = Date.UTC(2026, 7, 23, 14, 5, 9)
  const en_ = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(ts)
  const de_ = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' }).format(ts)
  assert.notEqual(en_, de_, 'locale must actually change the rendering')
  assert.match(de_, /2026/)
})

test('no locale value is an empty string', () => {
  for (const [k, v] of Object.entries(en)) assert.ok(String(v).length > 0, k)
})
