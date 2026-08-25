import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * This app is project-agnostic, and that is enforced rather than intended.
 *
 * Every threshold here came from measuring real repositories, and the measurements
 * are worth keeping — "the five longest files were all append-only logs" is why a
 * rule exists. The NAMES are not: a tool that ships one person's folder names in
 * its comments, tests and docs is a tool that reads as theirs, and on a public
 * repository it publishes what they were working on.
 *
 * So: keep the numbers, drop the identifiers. Say "a 14,000-file project", never
 * which one.
 *
 * The patterns below are built from parts so this file does not trip its own
 * check while describing what it forbids.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = 'server/agnostic.test.js'

const tracked = () =>
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter(f => f !== SELF && !f.startsWith('docs/demo') && !/\.(png|gif|mp4|woff2?|svg|ico)$/i.test(f))

/** A machine-specific absolute path — someone's home or dev root. */
const ABSOLUTE = new RegExp(['/App' + 'lications/MAMP', '/Users/[a-z]', '/home/[a-z]+/[a-z]'].join('|'), 'i')

/** The operator's own project-naming convention. */
const PROJECT_PREFIX = new RegExp('\\b' + 'prj' + '[0-9a-z._-]*', 'i')

function scan (re, allow = () => false) {
  const hits = []
  for (const f of tracked()) {
    let text
    try { text = readFileSync(join(ROOT, f), 'utf8') } catch { continue }
    text.split('\n').forEach((line, i) => {
      const m = line.match(re)
      if (m && !allow(f, line)) hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`)
    })
  }
  return hits
}

test('no machine-specific absolute path is committed', () => {
  // `/path/to/...` and `/home/dev/work/...` are deliberate neutral examples.
  const hits = scan(ABSOLUTE, (_f, line) => /\/home\/dev\/work/.test(line))
  assert.deepEqual(hits, [], 'replace with a neutral example path:\n' + hits.join('\n'))
})

test('no project name from the operator\'s own naming scheme is committed', () => {
  const hits = scan(PROJECT_PREFIX)
  assert.deepEqual(hits, [], 'name the measurement, not the project:\n' + hits.join('\n'))
})

test('the guard actually scans a meaningful number of files', () => {
  // A broken `git ls-files` would make every assertion above pass vacuously.
  assert.ok(tracked().length > 50, `only ${tracked().length} files scanned`)
})
