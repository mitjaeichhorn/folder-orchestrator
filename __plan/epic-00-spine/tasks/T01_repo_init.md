# T01 — Repo init and skeleton

## What
A git repository, a zero-dependency `package.json`, and the directory skeleton the spine lives in.

## Dependencies
- Tokens: none
- Types: none
- Services: none
- Primitives: none
- Context: none
- Platform: macOS, Node ≥ 25 (`node:sqlite` requires it) — verified v25.8 on this machine

## Files
- Create: `.gitignore`, `package.json`, `server/` (dir), `data/.gitkeep`, `logs/.gitkeep`

## How
`git init`. `package.json`: `{"name":"folder-orchestrator","private":true,"type":"module",
"engines":{"node":">=25"},"scripts":{"start":"node server/server.js","test":"node --test server/"}}`
— **no `dependencies` and no `devDependencies` keys at all**, so adding one is a visible diff.
`.gitignore`: `node_modules/`, `data/`, `logs/`, `web/dist/`, `.DS_Store`.

## Definition of Done
- [ ] `git log` shows one commit
- [ ] `node -e "import('node:sqlite').then(()=>console.log('ok'))"` prints `ok`
- [ ] `package.json` has no dependency keys
- [ ] `git status` is clean with `data/` and `logs/` populated

## Activation Task
`npm test` runs and reports 0 tests (not an error about a missing script).
