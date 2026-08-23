import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { log } from './log.js'
import { globToRe } from '../shared/glob.js'

export { globToRe }

export const DENY_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '.vite', 'coverage', '.turbo', 'vendor']
// Atomic-save editors write `foo.md.tmp.77` then rename. The temp file is an
// implementation detail of the save, never a change the operator made.
// `.!2248!name.ts` is an atomic-write artifact too — same class as `.tmp.NN`,
// different editor. Both are implementation details of a save, not a change.
export const DENY_GLOBS = ['*.log', '*.swp', '*~', '.DS_Store', '*.tmp', '*.tmp.*',
  '.*.swp', '*.crswap', '.!*!*', '.goutputstream-*', '*.sb-*']

function parseGitignore (root) {
  const file = join(root, '.gitignore')
  if (!existsSync(file)) return []
  try {
    return readFileSync(file, 'utf8').split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.startsWith('!')
        ? { negate: true, re: globToRe(l.slice(1)) }
        : { negate: false, re: globToRe(l) })
  } catch (err) {
    log('WARN', 'gitignore_parse', { root, message: err.message })
    return []
  }
}

const denyDirRe = new RegExp(`(^|/)(${DENY_DIRS.join('|')})(/|$)`, 'i')

export function compile (folder) {
  return {
    deny: denyDirRe,
    denyGlobs: DENY_GLOBS.map(globToRe),
    own: (folder.ignore || []).map(g => ({ negate: g.startsWith('!'), re: globToRe(g.replace(/^!/, '')) })),
    git: parseGitignore(folder.path)
  }
}

export function shouldIgnore (relPath, compiled) {
  const p = relPath.replaceAll('\\', '/')
  if (compiled.deny.test(p)) return true
  for (const re of compiled.denyGlobs) if (re.test(p)) return true
  let ignored = false
  for (const { negate, re } of [...compiled.git, ...compiled.own]) {
    if (re.test(p)) ignored = !negate // last match wins, gitignore semantics
  }
  return ignored
}
