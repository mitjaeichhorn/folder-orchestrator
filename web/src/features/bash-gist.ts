/** Kept free of runtime imports so it stays directly testable. */
/**
 * The gist of a shell command: what it actually ran. A pasted command is mostly
 * scaffolding — `cd` into the project the row already names, and `echo "=== x ==="`
 * banners for a log nobody reads here — and that scaffolding sits at the FRONT,
 * so truncation keeps the noise and drops the verb. Segments are stripped and the
 * rest counted rather than shown: one line answers "what tool", the panel has the
 * text.
 */
export function bashGist (cmd: string): string {
  // ponytail: split ignores quoting, so a `;` inside a string over-splits. It only
  // ever costs a shorter label; parse properly if that starts reading wrong.
  const parts = beforeHeredoc(String(cmd)).split(/\s*(?:&&|\|\||;|\n)\s*/)
    .map(s => stripAssignment(s.trim()))
    .filter(s => s && !/^(cd|echo|true|set|export|source|\.)\b/.test(s))
  if (!parts.length) return trim(cmd)
  const head = trim(parts[0])
  return parts.length > 1 ? `${head}  +${parts.length - 1}` : head
}

/**
 * A heredoc body is data, not a chain of commands. Measured on live rows:
 * `python3 - <<'EOF'` followed by a script read as `+21`, claiming twenty-one
 * commands ran when one did. Everything from the marker on is the script.
 */
const beforeHeredoc = (s: string) => {
  const i = s.search(/<<-?\s*['"]?[A-Za-z_]/)
  return i === -1 ? s : s.slice(0, s.indexOf('\n', i) === -1 ? s.length : s.indexOf('\n', i))
}

/**
 * `MB=$(git merge-base HEAD feat/x)` is a `git merge-base` call wearing a variable
 * name. The name is scaffolding for the *next* segment, never for the reader, and
 * it sits in front of the verb — the one place truncation cannot afford noise.
 */
const stripAssignment = (s: string) => {
  const m = /^[A-Za-z_][A-Za-z0-9_]*=(\$\()?\s*/.exec(s)
  if (!m) return s
  const rest = m[1] ? s.slice(m[0].length).replace(/\)$/, '') : s.slice(m[0].length)
  return rest.trim() || s
}

const trim = (s: string) => s.length > 140 ? s.slice(0, 140) + '…' : s
