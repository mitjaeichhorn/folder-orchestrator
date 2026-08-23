import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'src/features/Markdown.tsx'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/**
 * A watched folder can hold any repository, so its markdown is untrusted input
 * to our page. `react-markdown` drops embedded HTML unless `rehype-raw` is
 * added — the safe behaviour is the default, and the only way to lose it is to
 * install that plugin or hand-render HTML. Both are asserted against here,
 * because a comment saying "do not add this" is not a control.
 */

test('rehype-raw is not a dependency — raw HTML in a repo file cannot reach the page', () => {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const name of Object.keys(deps)) {
    assert.doesNotMatch(name, /rehype-raw|remark-html|rehype-stringify/, `${name} re-enables raw HTML`)
  }
})

test('the renderer passes no rehype plugins and never sets inner HTML', () => {
  assert.doesNotMatch(src, /rehypePlugins/, 'a rehype plugin can reintroduce raw HTML')
  assert.doesNotMatch(src, /dangerouslySetInnerHTML/)
})

test('GFM is enabled, or tables in our own docs render as pipes', () => {
  assert.match(src, /remarkPlugins=\{\[remarkGfm\]\}/)
})

test('external links carry noopener, so a linked page cannot reach window.opener', () => {
  assert.match(src, /rel="noopener noreferrer"/)
})
