import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

function sources (dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'data', 'logs', '__plan', '__documentation'].includes(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) sources(p, out)
    else if (/\.(js|ts|tsx)$/.test(e.name) && !e.name.includes('no-llm')) out.push(p)
  }
  return out
}

// Invariant 5 of the event contract: no module in this repo calls an inference API.
// An unenforced convention decays — assume it already has.
const FORBIDDEN = [
  /api\.anthropic\.com/i, /api\.openai\.com/i, /generativelanguage\.googleapis/i,
  /\bopenai\b/i, /@anthropic-ai\//i, /\bAnthropic\s*\(/, /\bOpenAI\s*\(/,
  /claude-[a-z0-9-]*\d/i, /gpt-[0-9]/i, /\bcompletions?\.create\b/, /\bmessages\.create\b/,
  /\bllm\b/i, /\bembedding/i
]

test('no source file references an inference API', () => {
  const hits = []
  for (const f of sources(ROOT)) {
    const text = stripComments(readFileSync(f, 'utf8'))
    for (const re of FORBIDDEN) {
      const m = text.match(re)
      if (m) hits.push(`${f.replace(ROOT + '/', '')}: ${re} -> ${JSON.stringify(m[0])}`)
    }
  }
  assert.deepEqual(hits, [], 'zero-LLM invariant broken:\n' + hits.join('\n'))
})

test('no dependency in any package.json is an LLM SDK', () => {
  for (const pkg of [join(ROOT, 'package.json'), join(ROOT, 'web', 'package.json')]) {
    if (!existsSync(pkg)) continue
    const d = JSON.parse(readFileSync(pkg, 'utf8'))
    const names = [...Object.keys(d.dependencies ?? {}), ...Object.keys(d.devDependencies ?? {})]
    for (const n of names) {
      assert.doesNotMatch(n, /anthropic|openai|langchain|llamaindex|cohere|mistral|ollama|transformers/i,
        `${pkg}: ${n}`)
    }
  }
})

test('the server has zero runtime dependencies', () => {
  const d = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(d.dependencies, undefined, 'server must stay stdlib-only')
})

test('the topic is transcribed, never shortened by meaning', () => {
  // Truncation must be by character count only. A word-boundary or sentence-aware
  // trim is the first step toward summarisation.
  const src = readFileSync(join(ROOT, 'server', 'transcripts.js'), 'utf8')
  const assignments = [...src.matchAll(/topics\.set\([^)]*\)/g)].map(m => m[0])
  assert.ok(assignments.length >= 2, 'expected the topic to be set from prompts')
  for (const a of assignments) {
    if (a.includes('_setTopic') || !a.includes('slice')) continue
    assert.match(a, /slice\(0, TOPIC_MAX\)/, `not a plain character slice: ${a}`)
  }
  // A word-boundary or sentence-aware trim is the first step toward summarisation.
  // Check code only — comments legitimately discuss summarisation to forbid it.
  assert.doesNotMatch(stripComments(src), /lastIndexOf\(' '\)|\bsummar/i, 'no meaning-aware trimming')
})

test('reading a stored title is not generating one', () => {
  // `aiTitle` is written by a model UPSTREAM, in Claude Code, before this app
  // opens the file. The distinction this suite protects is reading vs running:
  // nothing here may call inference, and displaying a field someone else
  // generated is not calling inference. Same precedent as the Bash description.
  const src = readFileSync(new URL('./transcripts.js', import.meta.url), 'utf8')
  assert.match(src, /o\.aiTitle/, 'the title is read from the record')
  assert.doesNotMatch(src, /summari[sz]e|generateTitle|createCompletion/i,
    'and never derived here')
})
