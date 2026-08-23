# T03 — log.js

## What
Structured JSONL logging with size-based rotation. The only logging mechanism in `server/`.

## Dependencies
- Types: none
- Services: `node:fs` (`appendFileSync`, `statSync`, `renameSync`), `node:path`
- Primitives: none
- Context: none
- Platform: none

## How
`log(level, code, fields)` → appends `{ts, level, code, ...fields}\n` to `logs/orchestrator.jsonl`.
Levels: `DEBUG|INFO|WARN|ERROR|FATAL`. `DEBUG` written only when `ORCH_DEBUG=1`.
Rotation before append: if size ≥ 10MB, rename `.jsonl` → `.jsonl.1` (shifting `.1`→`.2`,
`.2`→`.3`, dropping `.3`). Synchronous — this is a localhost tool at human event rates, and an
async logger that loses the last lines before a crash defeats the purpose.
Errors: `log('ERROR', code, {message, stack, ...ctx})`. A logging failure must never throw into
the caller — wrap the append in try/catch and fall back to `process.stderr.write` once.

## Files
- Create: `server/log.js`

## Definition of Done
- [ ] Every line is independently `JSON.parse`able
- [ ] `ts` is epoch ms, `level` and `code` always present
- [ ] Rotation at 10MB produces `.1`, and a fourth rotation drops the oldest — 4 files max on disk
- [ ] `DEBUG` lines absent without `ORCH_DEBUG=1`, present with it
- [ ] An unwritable `logs/` does not throw into the caller
- [ ] `grep -rn 'console\.' server/ --include='*.js' | grep -v test` is empty

## Activation Task
Write 11MB of log lines; `ls logs/` shows `orchestrator.jsonl` and `orchestrator.jsonl.1`, and
`tail -1 logs/orchestrator.jsonl | python3 -m json.tool` parses.
