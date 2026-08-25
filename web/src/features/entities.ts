/**
 * What ties a run of rows together is the handful of names that keep coming back:
 * a branch, a file, a symbol. In the feed they sit at different offsets inside
 * long command strings, so nothing links the rows visually and fourteen rows of
 * one investigation read as fourteen unrelated events.
 *
 * This counts which tokens recur and marks those occurrences. It does not rank
 * them by importance, name what they are, or draw a conclusion — the repetition
 * is the whole signal, and the reader supplies the meaning.
 *
 * Kept free of runtime imports so it stays directly testable.
 */

const MIN_ROWS = 2
const CAP = 6

/**
 * Shell punctuation. `:` is in the list on purpose: `git show`'s
 * `feat/x:admin/api.ts` names a branch AND a file, and left whole it would recur
 * as neither — it is the one token where splitting recovers two real names.
 */
const SPLIT = /[\s;:|&"'`()<>{}[\],=]+/

/**
 * Names, not prose. A token qualifies on shape alone:
 * a ref (`feat/admin-api-split`, `HEAD`, a sha), a path with an extension, or a
 * SCREAMING_SNAKE identifier. Everything else in a command line is a verb, a flag
 * or a word — none of which mean anything by recurring.
 */
function isName (tok: string): boolean {
  if (tok.length < 4 || tok.length > 120) return false
  if (/^-/.test(tok)) return false                          // a flag repeats by nature
  if (/^[0-9a-f]{7,40}$/.test(tok)) return true             // a commit
  if (tok === 'HEAD') return true
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(tok.replace(/^_/, ''))) return true
  if (tok.includes('/') && /\.[a-z0-9]{1,6}$/i.test(tok)) return true   // a path to a file
  if (/^(feat|fix|chore|refactor|release|hotfix)\//.test(tok)) return true
  return false
}

/** Every name-shaped token in one label, deduped. */
export function namesIn (label: string): string[] {
  return [...new Set(String(label).split(SPLIT).filter(isName))]
}

/**
 * Tokens that appear in at least `minRows` DISTINCT rows. Distinct rows, not total
 * occurrences: one row naming the same file three times proves nothing about the
 * run, and would otherwise outrank a name genuinely threaded through five rows.
 */
export function recurring (labels: string[], minRows = MIN_ROWS, cap = CAP): string[] {
  const rows = new Map<string, number>()
  for (const label of labels) {
    for (const tok of namesIn(label)) rows.set(tok, (rows.get(tok) ?? 0) + 1)
  }
  return [...rows.entries()]
    .filter(([, n]) => n >= minRows)
    // longest first so `admin/src/lib/api.ts` claims its span before a shorter
    // token nested inside it can split the string underneath it
    .sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([tok]) => tok)
}

export interface Part { t: string; mark: boolean }

/**
 * Split a label into marked and unmarked runs. Loss-free by construction — the
 * parts concatenate back to the input — because a highlight that silently drops
 * a character is worse than no highlight.
 */
export function splitOn (label: string, marks: string[]): Part[] {
  const s = String(label)
  if (!marks.length) return [{ t: s, mark: false }]
  const out: Part[] = []
  let i = 0
  while (i < s.length) {
    // marks arrive longest-first, so the longest match at this position wins
    const hit = marks.find(m => m && s.startsWith(m, i))
    if (hit) {
      out.push({ t: hit, mark: true })
      i += hit.length
    } else {
      const last = out[out.length - 1]
      if (last && !last.mark) last.t += s[i]
      else out.push({ t: s[i], mark: false })
      i++
    }
  }
  return out
}
