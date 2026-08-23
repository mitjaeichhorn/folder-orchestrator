# Epic 02: Claude activity

## Context
Sits beside the watcher, one layer above the filesystem, reading a different source: the JSONL
transcripts Claude Code appends under `~/.claude/projects/<slug>/*.jsonl`. It is fed by those
files (via the same `fs.watch` primitive as Epic 01) and feeds `emit()` plus the attribution join
that re-labels watcher events. It exists because the filesystem cannot tell you *who* wrote a
file, and "see what Claude Code is doing" is half the product.

## What
`server/transcripts.js` and `server/attribution.js`:
- discover the transcript directory for a watched folder by slugifying its absolute path
- tail every `*.jsonl` in it — read from a byte offset, parse whole lines only, survive rotation
- emit `kind: 'tool'` events (name, input, result) and `kind: 'prompt'` events
- correlate: when a `tool` event names a file path, re-label the matching watcher event
  `actor: 'claude'` with its `sessionId`

## Why
Without it the feed shows *that* `App.tsx` changed but not that Claude changed it, mid-session,
via `Edit`, as part of a task the operator never approved. That is precisely the moment the
operator wanted to catch. It also delivers the diff for free — `Edit` tool inputs carry
`old_string`/`new_string`, so the detail panel needs no git, no snapshotting, and no model.

## How
1. **Slug mapping.** `/Applications/MAMP/htdocs/prj-app` → `-Applications-MAMP-htdocs-prj-app`
   (non-alphanumerics to `-`). Verified against the 50 existing directories on this machine.
   Resolve at watch-start; if absent, no transcripts — not an error, the project may never have
   been opened in Claude Code.
2. **Tailing.** Per file keep `{ino, offset}`. On change: `stat`; if `ino` differs or `size <
   offset`, the file was rotated or truncated — reset to 0. Read `offset..size`, split on `\n`,
   keep the trailing partial in a buffer. Never parse a partial line.
3. **Parsing.** Verified shapes on this machine: `type: "assistant"` with `message.content[]`
   blocks where `type === "tool_use"` (`name`, `input`); `type: "user"` for prompts; top-level
   `timestamp`, `sessionId`, `cwd`, `gitBranch`, `toolUseResult`. Everything else
   (`queue-operation`, `ai-title`, `file-history-snapshot`, `last-prompt`, `attachment`, …) is
   noise. **Unknown `type` is skipped silently** — contract invariant 4.
4. **Path extraction per tool.** `Edit`/`Write`/`Read`/`NotebookEdit` → `input.file_path`.
   `Bash` → no path, emit with `path: null`. Anything else → no path. A table, not a heuristic;
   an unknown tool contributes a `tool` event with `path: null` rather than a guessed path.
5. **Attribution join.** Keep the last 30s of watcher events in memory keyed by absolute path.
   A `tool` event with a path matches the watcher event for the same absolute path within
   ±5s → `UPDATE events SET actor='claude', session_id=?` and push a `patch` SSE frame.
   No match → the watcher event stays `external`. Never infer from timing alone.
6. **Diff detail.** For `Edit`, compute `linesAdded`/`linesRemoved` from `old_string`/`new_string`
   by line count — a subtraction, not a diff algorithm. Store both strings in `detail.input` so
   the UI can render them; truncate each at 4KB.

Migration strategy: none. This epic only *adds* rows and *relabels* existing ones, so it can be
switched off (`enabled` flag per folder) without breaking Epic 01's output — that is the rollback.

## Definition of Done
- [ ] For a folder with an existing transcript, starting the watcher emits **no** historical tool events — tailing begins at current EOF, not byte 0
- [ ] Running a Claude Code session in a watched folder produces one `tool` event per tool call, in order, within 2s of the call
- [ ] An `Edit` in that session produces a `tool` event **and** relabels the watcher's `modified` event for the same file to `actor: 'claude'` with the correct `sessionId`
- [ ] A file changed by the operator's editor (no Claude session running) stays `actor: 'external'` — zero false `claude` labels across a 30-minute mixed session
- [ ] A transcript line containing an unknown `type` is skipped without throwing and without a log at ERROR
- [ ] A truncated final line (mid-write) is buffered, not parsed, and completes correctly on the next append
- [ ] Deleting and recreating a transcript file (ino change) resets the offset and does not replay
- [ ] `detail.input.old_string` / `new_string` present for `Edit`, each ≤ 4KB
- [ ] A folder with no `~/.claude/projects` directory watches normally with zero transcript events and no error
- [ ] `node --test server/` passes, transcript tests included

## Test Plan
Level 1 (deterministic), `server/transcripts.test.js` — fixture JSONL written line by line into a
temp file, real tailer:
- slug mapping round-trip against the 50 real directory names on this machine (read-only assertion)
- append-while-tailing: 3 lines → 3 events; partial line held back until its `\n` arrives
- rotation: truncate to 0 → offset resets, no replay of earlier lines
- unknown `type` values from a captured real transcript → skipped, no throw, event count exact
- path extraction table: `Edit`/`Write`/`Read` → path; `Bash` → null; unknown tool → null
- `linesAdded`/`linesRemoved` arithmetic on a known old/new pair
- attribution: matching pair inside ±5s relabels; same paths 30s apart do **not**; different
  paths at the same instant do **not**

Level 2 (integration): the activation task — a real Claude Code session in a real watched folder.
Level 3: none.

## Failure Mode

| If X fails | Y happens |
|---|---|
| Transcript dir absent for a folder | No transcript events, `INFO no_transcripts` once at watch-start. **Fails open** — most watched folders will never have one. |
| A JSONL line is invalid JSON | Line skipped, `WARN bad_line` with byte offset and first 80 chars. Tailing continues. Fails open — one corrupt line must not stop the stream. |
| Transcript format changes (new `type`, moved field) | Unknown records skipped silently; known records that lose a required field are skipped at `WARN schema_miss`. The product degrades to filesystem-only, which is still useful. **Degrades, never crashes.** |
| Attribution window ambiguous (two sessions edit the same file) | Both candidates logged at `WARN attribution_ambiguous`; the event stays `external`. **Fails toward `external`** — a wrong `claude` label is worse than a missing one, because the operator acts on it. |
| Transcript file grows faster than the tailer reads | Read is chunked and offset-based; it catches up. If lag exceeds 5s, `WARN tail_lag` with the byte gap. |
| `~/.claude` unreadable | Transcript tailing disabled process-wide, `ERROR claude_dir_unreadable`, watcher unaffected. |

## Logging & Observability

| What to log | Destination | Format | Rotation |
|---|---|---|---|
| Tailer start: ts, folder_id, transcript_path, start_offset, ino | `logs/orchestrator.jsonl` | JSONL | 10MB × 3 |
| Every parsed record at DEBUG: ts, session_id, record_type, tool_name, path, emitted (bool), skip_reason | same | JSONL | same |
| Attribution decision at INFO: ts, path, tool_event_id, matched_fs_event_id or null, delta_ms, outcome (`relabelled` / `no_match` / `ambiguous`) | same | JSONL | same |
| Rotation/reset: ts, file, old_ino, new_ino, old_offset | same | JSONL | same |
| Tail lag: ts, folder_id, bytes_behind | same | JSONL | same |
| Every error: ts, code, file, offset, message, stack | same | JSONL | same |

The attribution line is the important one: every `claude` label in the UI must be traceable to a
logged decision with its `delta_ms`. If a label is ever wrong, the log says why without a rerun.

## Dependencies
- Epic 00 (spine): `emit()`, `log()`, the events table, the `patch` SSE frame (declared in the contract doc's
  frame table; Epic 00 implements the fan-out for all frame types).
- Epic 01 (watcher): the in-memory recent-events index the join reads. Also the `fs.watch`
  wrapper, reused for transcript files.

## Owner
- **Builds:** implementation agent, own worktree.
- **Advises:** planner on the attribution window and the fail-toward-`external` rule.
- **Validates:** reviewer agent + a real 30-minute mixed session (operator edits and Claude edits
  interleaved), checking for zero false `claude` labels.

## Activation Task

| What to execute | Expected output | Where output lands |
|---|---|---|
| Add this project as a watched folder, then run a real Claude Code session in it that edits one file | `tool` rows for each call, in order; the `Edit`'s file shows `actor='claude'` with the session uuid | `data/orchestrator.db`; live on `/api/stream` |
| `select actor, count(*) from events where folder_id=? group by actor` after a 30-min mixed session | Both `claude` and `external` present; manual spot-check of 10 `claude` rows finds 0 wrong | stdout, pasted into this epic |
| `grep attribution_ambiguous logs/orchestrator.jsonl` | Count recorded here, with a note on whether the ±5s window needs tuning | this file |

Not complete until run against a real session with the counts recorded.

## Activation Evidence
**2026-08-23** — run against a real Claude Code session (the session that built this project).

- Transcript slug resolved: `-Applications-MAMP-htdocs-prj25-folder-orchestrator`.
- `tool` events captured live for `Bash`, `Edit`, `Read`, `ToolSearch` and MCP tools, each
  carrying the correct `sessionId` (`2efdb390`).
- **Attribution join confirmed:** a real `Edit` on `ACTIVATION_PROBE.md` relabelled the
  watcher's `modified` row from `external` to `claude`, `delta_ms: -75`, matched fs event id 5.
  Logged as `{"code":"attribution","outcome":"relabelled"}`.
- **Free diff confirmed:** `detail.input.old_string` / `new_string` captured verbatim from the
  Edit tool input, with `linesAdded: 2` / `linesRemoved: 1`. No git, no snapshot, no model.
- `Bash` tool events correctly carry `path: null` and are never attributed to a file.
- The atomic-save temp file `ACTIVATION_PROBE.md.tmp.77` was correctly labelled `external`
  (it is not a Claude tool call) — and is now filtered entirely.
- Actor split over the run: `claude: 21`, `external: 17`. Spot-check of the `claude` rows
  found 0 wrong labels.
