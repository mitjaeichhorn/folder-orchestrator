import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { parseLine, slugify, noteFsEvent, attribute, _recent, topicOf, _setTopic, primeTopics, closeToolCall, _inFlightSize } from './transcripts.js'

const asst = (tool, input, ts = '2026-08-23T10:00:00.000Z', sid = 'S1') => JSON.stringify({
  type: 'assistant', timestamp: ts, sessionId: sid,
  message: { content: [{ type: 'tool_use', name: tool, input }] }
})

test('slugify matches the real project directory names on this machine', () => {
  const dirs = readdirSync(join(homedir(), '.claude', 'projects'), { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name)
  assert.ok(dirs.length > 0, 'no transcript dirs to verify against')
  assert.equal(slugify('/Applications/MAMP/htdocs/prj-app'), '-Applications-MAMP-htdocs-prj-app')
  // every real dir name must be a fixed point of the slug alphabet
  for (const d of dirs) assert.match(d, /^[a-zA-Z0-9-]+$/, d)
})

test('unknown record types are skipped silently', () => {
  for (const type of ['queue-operation', 'ai-title', 'file-history-snapshot', 'last-prompt', 'attachment', 'system']) {
    const r = parseLine(JSON.stringify({ type, timestamp: '2026-08-23T10:00:00.000Z' }), 'F')
    assert.equal(r.skip, 'unhandled_type')
    assert.equal(r.events, undefined)
  }
})

test('invalid JSON is reported, not thrown', () => {
  assert.equal(parseLine('{not json', 'F').skip, 'bad_json')
})

test('path extraction is a table: Edit/Write/Read yield paths, Bash and unknown do not', () => {
  assert.equal(parseLine(asst('Edit', { file_path: '/a/b.ts', old_string: 'x', new_string: 'y' }), 'F').events[0].path, '/a/b.ts')
  assert.equal(parseLine(asst('Write', { file_path: '/a/c.ts' }), 'F').events[0].path, '/a/c.ts')
  assert.equal(parseLine(asst('Read', { file_path: '/a/d.ts' }), 'F').events[0].path, '/a/d.ts')
  assert.equal(parseLine(asst('Bash', { command: 'ls' }), 'F').events[0].path, null)
  assert.equal(parseLine(asst('SomeFutureTool', { thing: 1 }), 'F').events[0].path, null)
})

test('Edit line counts come from old_string/new_string arithmetic', () => {
  const e = parseLine(asst('Edit', { file_path: '/a.ts', old_string: 'a\nb\nc', new_string: 'a\nb\nc\nd\ne' }), 'F').events[0]
  assert.equal(e.detail.linesRemoved, 3)
  assert.equal(e.detail.linesAdded, 5)
  assert.equal(e.tool, 'Edit')
  assert.equal(e.actor, 'claude')
  assert.equal(e.sessionId, 'S1')
})

test('oversized strings are clipped and marked truncated', () => {
  const big = 'x'.repeat(5000)
  const e = parseLine(asst('Edit', { file_path: '/a.ts', old_string: '', new_string: big }), 'F').events[0]
  assert.equal(e.detail.input.new_string.truncated, true)
  assert.equal(e.detail.input.new_string.text.length, 4096)
})

test('a user prompt becomes a prompt event capped at 200 chars', () => {
  const line = JSON.stringify({ type: 'user', timestamp: '2026-08-23T10:00:00.000Z', sessionId: 'S1', message: { content: 'y'.repeat(500) } })
  const e = parseLine(line, 'F').events[0]
  assert.equal(e.kind, 'prompt')
  assert.equal(e.detail.text.length, 200)
})

test('multiple tool_use blocks in one record yield multiple events', () => {
  const line = JSON.stringify({
    type: 'assistant', timestamp: '2026-08-23T10:00:00.000Z', sessionId: 'S1',
    message: { content: [
      { type: 'text', text: 'thinking' },
      { type: 'tool_use', name: 'Read', input: { file_path: '/a' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }
    ] }
  })
  assert.equal(parseLine(line, 'F').events.length, 2)
})

// --- running / finished tool calls ---------------------------------------
const asstWithId = (tool, id, ts = '2026-08-23T10:00:00.000Z') => JSON.stringify({
  type: 'assistant', timestamp: ts, sessionId: 'R1',
  message: { content: [{ type: 'tool_use', id, name: tool, input: { command: 'sleep 5' } }] }
})
const toolResult = (id, ts, isError = false) => JSON.stringify({
  type: 'user', timestamp: ts, sessionId: 'R1',
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] }
})

test('a tool call is emitted as running, carrying its id', () => {
  const e = parseLine(asstWithId('Bash', 'tu_1'), 'F').events[0]
  assert.equal(e.detail.state, 'running', 'the row can be shown before the work finishes')
  assert.equal(e.detail.toolUseId, 'tu_1')
  assert.equal(e.detail.durationMs, undefined)
})

test('a tool_result record is parsed as a result, not as an event', () => {
  const r = parseLine(toolResult('tu_1', '2026-08-23T10:00:05.000Z'), 'F')
  assert.equal(r.events, undefined, 'a result closes a row, it never adds one')
  assert.deepEqual(r.results, [{ toolUseId: 'tu_1', ts: Date.parse('2026-08-23T10:00:05.000Z'), isError: false }])
})

test('an error result is distinguishable from a successful one', () => {
  const r = parseLine(toolResult('tu_2', '2026-08-23T10:00:05.000Z', true), 'F')
  assert.equal(r.results[0].isError, true)
})

test('a user record with no tool_result is still skipped silently', () => {
  const line = JSON.stringify({ type: 'user', timestamp: '2026-08-23T10:00:00.000Z', message: { content: [{ type: 'text', text: 'hi' }] } })
  assert.equal(parseLine(line, 'F').skip, 'unhandled_type')
})

test('closing an unknown tool id is a no-op, not a crash', () => {
  assert.equal(closeToolCall('F', { toolUseId: 'never-seen', ts: Date.now() }), null)
})

// --- topic ---------------------------------------------------------------
const lastPrompt = (text, sid = 'T1') => JSON.stringify({ type: 'last-prompt', lastPrompt: text, sessionId: sid })

test('a last-prompt record sets the topic and emits no event', () => {
  const r = parseLine(lastPrompt('build the watcher', 'T1'), 'F')
  assert.equal(r.events, undefined, 'the topic record is not itself an event')
  assert.equal(r.skip, 'topic_recorded')
  assert.equal(topicOf('T1'), 'build the watcher')
})

test('the topic is stamped onto every tool call that follows it', () => {
  parseLine(lastPrompt('fix the feed', 'T2'), 'F')
  const e = parseLine(asst('Bash', { command: 'ls' }, '2026-08-23T10:00:00.000Z', 'T2'), 'F').events[0]
  assert.equal(e.topic, 'fix the feed')
})

test('a later prompt replaces the topic for that session only', () => {
  parseLine(lastPrompt('first thing', 'T3'), 'F')
  parseLine(lastPrompt('second thing', 'T3'), 'F')
  parseLine(lastPrompt('other session', 'T4'), 'F')
  assert.equal(topicOf('T3'), 'second thing')
  assert.equal(topicOf('T4'), 'other session')
})

test('a multi-line prompt is reduced to its first line and capped', () => {
  parseLine(lastPrompt('the headline\nthen a lot of detail\nand more', 'T5'), 'F')
  assert.equal(topicOf('T5'), 'the headline')
  parseLine(lastPrompt('x'.repeat(400), 'T6'), 'F')
  assert.equal(topicOf('T6').length, 160, 'capped, never unbounded')
})

test('an unknown session has no topic rather than a borrowed one', () => {
  assert.equal(topicOf('never-seen'), null)
})

test('the topic is transcribed verbatim, never summarised', () => {
  const raw = 'create clear epics and task based on htdocs/__claude_setup description'
  parseLine(lastPrompt(raw, 'T7'), 'F')
  assert.equal(topicOf('T7'), raw, 'must be the exact prompt text')
})

test('primeTopics recovers the current topic from an existing transcript', t => {
  const d = mkdtempSync(join(tmpdir(), 'orcht-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  const f = join(d, 's.jsonl')
  writeFileSync(f, [
    JSON.stringify({ type: 'last-prompt', lastPrompt: 'an older topic', sessionId: 'P1' }),
    JSON.stringify({ type: 'assistant', sessionId: 'P1', message: { content: [] } }),
    JSON.stringify({ type: 'last-prompt', lastPrompt: 'the current topic', sessionId: 'P1' }),
    JSON.stringify({ type: 'last-prompt', lastPrompt: 'other session topic', sessionId: 'P2' })
  ].join('\n') + '\n')
  assert.equal(primeTopics(f), 3)
  assert.equal(topicOf('P1'), 'the current topic', 'latest wins')
  assert.equal(topicOf('P2'), 'other session topic')
})

test('primeTopics survives a malformed or partial trailing line', t => {
  const d = mkdtempSync(join(tmpdir(), 'orcht-'))
  t.after(() => rmSync(d, { recursive: true, force: true }))
  const f = join(d, 's.jsonl')
  writeFileSync(f, JSON.stringify({ type: 'last-prompt', lastPrompt: 'good', sessionId: 'P3' }) + '\n{"type":"last-pro')
  assert.doesNotThrow(() => primeTopics(f))
  assert.equal(topicOf('P3'), 'good')
})

test('primeTopics on a missing file returns 0 rather than throwing', () => {
  assert.equal(primeTopics('/nope/nope.jsonl'), 0)
})

// --- attribution ---------------------------------------------------------
const toolEv = (path, ts) => ({ folderId: 'F', path, ts, sessionId: 'S1', kind: 'tool' })

test('attribution relabels a match inside the window', () => {
  noteFsEvent('F', 11, '/root/a.ts', 1000)
  const hit = attribute(toolEv('/root/a.ts', 3000))
  assert.equal(hit.id, 11)
})

test('attribution refuses a match outside the window', () => {
  noteFsEvent('F2', 12, '/root/b.ts', 1000)
  assert.equal(attribute(toolEv('/root/b.ts', 1000 + 9000)), null)
})

test('attribution refuses a different path at the same instant', () => {
  noteFsEvent('F3', 13, '/root/c.ts', 1000)
  assert.equal(attribute({ folderId: 'F3', path: '/root/OTHER.ts', ts: 1000, sessionId: 'S1' }), null)
})

test('ambiguous candidates fail toward external, never a guess', () => {
  noteFsEvent('F4', 21, '/root/d.ts', 1000)
  noteFsEvent('F4', 22, '/root/d.ts', 1200)
  assert.equal(attribute(toolEv('/root/d.ts', 1100)), null, 'must not pick one')
})

test('recent index evicts entries older than the TTL', () => {
  noteFsEvent('F5', 1, '/x', 0)
  noteFsEvent('F5', 2, '/x', 100000)
  assert.equal(_recent('F5').length, 1)
})

test('a tool event with no path or no session is never attributed', () => {
  assert.equal(attribute({ folderId: 'F', path: null, ts: 1, sessionId: 'S1' }), null)
  assert.equal(attribute({ folderId: 'F', path: '/a', ts: 1, sessionId: null }), null)
})
