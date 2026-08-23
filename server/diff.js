import { execFile } from 'node:child_process'
import { resolveInside } from './serve-file.js'
import { log } from './log.js'

export const MAX_DIFF_BYTES = 200 * 1024
const TIMEOUT_MS = 5000

/**
 * Real diffs for files nobody edited through a tool.
 *
 * The Edit tool carries old_string/new_string, so those rows diff for free. A
 * file written by Bash, a formatter, or the operator's editor carries nothing —
 * but the watched folder is almost always a git repo, and git already knows.
 *
 * This is working-tree-vs-HEAD, NOT the diff of one event: later changes to the
 * same file are included. The UI must say so rather than implying otherwise.
 */
function run (cwd, args) {
  return new Promise(resolve => {
    // execFile, never exec: no shell, and `--` stops a filename being read as a flag
    execFile('git', args, { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_DIFF_BYTES * 2 },
      (err, stdout) => resolve(err && !stdout ? null : String(stdout ?? '')))
  })
}

export async function fileDiff (folder, relPath) {
  try {
    resolveInside(folder.path, relPath)   // rejects traversal and symlink escapes
  } catch (err) {
    // a deleted file has no bytes but still has a diff, so MISSING is not fatal
    if (err.code !== 'MISSING') return { available: false, reason: err.code }
  }

  const isRepo = await run(folder.path, ['rev-parse', '--is-inside-work-tree'])
  if (!isRepo || isRepo.trim() !== 'true') {
    return { available: false, reason: 'NOT_A_REPO' }
  }

  // unstaged first — that is what a just-changed file usually is
  let text = await run(folder.path, ['diff', '--no-color', '--', relPath])
  let against = 'worktree'

  if (!text?.trim()) {
    text = await run(folder.path, ['diff', '--no-color', 'HEAD', '--', relPath])
    against = 'head'
  }

  if (!text?.trim()) {
    // untracked: git says nothing, so ask it to compare against an empty tree
    const untracked = await run(folder.path, ['ls-files', '--others', '--error-unmatch', '--', relPath])
    if (untracked?.trim()) {
      text = await run(folder.path, ['diff', '--no-color', '--no-index', '--', '/dev/null', relPath]) ?? ''
      against = 'untracked'
    }
  }

  if (!text?.trim()) return { available: false, reason: 'NO_CHANGES', against }

  const truncated = text.length > MAX_DIFF_BYTES
  log('DEBUG', 'diff', { folder_id: folder.id, path: relPath, against, bytes: text.length })
  return {
    available: true,
    source: 'git',
    against,
    truncated,
    text: truncated ? text.slice(0, MAX_DIFF_BYTES) : text
  }
}
