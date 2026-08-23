# T01 — Ignore matching

## What
`shouldIgnore(relPath, folder)` — the filter that runs before everything else in the watcher.

## Dependencies
- Types: `Folder` (`.ignore` JSON array) — contract doc
- Services: `node:fs` (`readFileSync` for `.gitignore`), `node:path`
- Primitives: none
- Context: none
- Platform: macOS path semantics; case-insensitive filesystem — match case-insensitively

## Files
- Create: `server/ignore.js`

## How
Deny-list constant, always applied: `node_modules`, `.git`, `dist`, `build`, `.next`, `.vite`,
`coverage`, `.DS_Store`, `*.log`, `*.swp`, `*~`.
Plus the folder's own `ignore` array. Plus `.gitignore` at the folder root when present
(nested `.gitignore` files honoured relative to their own directory).
Glob matching: build one `RegExp` per pattern at load time and cache it on the folder — compiling
per event is the difference between 20k cheap checks and 20k expensive ones.
Support `*`, `**`, `?`, leading `!` negation (last match wins, gitignore semantics), trailing `/`
meaning directory-only.
Any path segment equal to a deny-list directory name ignores the whole subtree — do not walk it.

## Definition of Done
- [ ] `node_modules/foo/bar.js` ignored; `src/node_modules_helper.js` **not** ignored (segment match, not substring)
- [ ] `.gitignore` with `dist/` and `!dist/keep.txt` → `dist/a.js` ignored, `dist/keep.txt` kept
- [ ] Nested `.gitignore` applies relative to its own directory
- [ ] Unparseable `.gitignore` → deny-list still applies, `WARN gitignore_parse`, no throw
- [ ] Patterns compiled once per folder, not per event — asserted by spying on the compile function
- [ ] 20,000 path checks complete in under 50ms

## Activation Task
`node -e` run of `shouldIgnore` over the real file list of
`/Applications/MAMP/htdocs/prj-migration-assistant-v4` (21,734 paths): print total, ignored, kept.
Kept must be ≈14,978. Paste all three numbers into `../EPIC.md`.
