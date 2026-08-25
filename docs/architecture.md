# Architecture

Two independent producers write into one event stream. Everything downstream — storage, SSE,
every view in the UI — treats their output as the same row type.

```
  fs.watch(dir, {recursive:true})          tail ~/.claude/projects/<slug>/*.jsonl
            │                                            │
      normalise.js                                 transcripts.js
   rename/change ─► created                  JSONL record ─► tool | prompt
   /modified/deleted/renamed                 message.usage ─► token_usage table
            │                                            │
      ignore.js  (filter here, never in the UI)          │
            │                                            │
            └──────────────► bus.emit() ◄────────────────┘
                                 │
                    ┌────────────┼───────────────┐
                    ▼            ▼               ▼
               db.js/sqlite   rules.match()   SSE fan-out
                                 │                │
                              alert event    EventSource
                                 │                │
                                 └──► bus.emit ───┘
```

`bus.emit()` is the single choke point. It inserts, fans out to subscribers, and hands the event
to the rule matcher — in that order, and it fans out even when the insert throws. History loss
beats liveness loss for a live dashboard.

## Server modules

| File | Responsibility |
|---|---|
| `server/server.js` | HTTP routes, static serving, boot sequence |
| `server/watcher.js` | one recursive `fs.watch` per folder, debounce, rate ceiling, status |
| `server/normalise.js` | macOS `rename`/`change` → `created`/`modified`/`deleted`/`renamed` |
| `server/ignore.js` | deny dirs, deny globs, `.gitignore`, per-folder ignore list |
| `server/transcripts.js` | tail Claude Code JSONL, parse records, attribution, containment, topics |
| `server/bus.js` | insert + SSE fan-out + matcher dispatch, keepalive ping |
| `server/db.js` + `schema.sql` | `node:sqlite`, all queries |
| `server/rules.js` | alert rule matching, cooldown, global cap, seeded defaults |
| `server/tree.js` | project tree walk + line counting for the heat map |
| `server/diff.js` | git-backed diff for files no tool call described |
| `server/serve-file.js` | allow-listed file bytes, path containment, symlink check |
| `server/pick-folder.js` | native macOS folder dialog via a fixed AppleScript |
| `server/log.js` | JSONL log with size rotation |
| `shared/glob.js` | glob→regex, event matching, extension lists — shared with the frontend |

## The watcher

`startWatch` walks the tree once to build `seen: Map<relPath, inode>`, then opens a single
recursive `fs.watch`. FSEvents backs it, so one stream covers arbitrary depth, including
directories created *after* the watch starts.

Per raw event:

1. **Ignore check** — before anything else. An ignored path never reaches SQLite or SSE.
2. **Debounce, 50ms per path** — one editor save is often a temp file plus a rename.
3. **Normalise** — `stat()` the path and compare against `seen`:
   - `ENOENT` → `deleted`, and the inode goes into `pendingDeletes`
   - not in `seen`, inode matches a pending delete within **500ms** → `renamed`
   - not in `seen` → `created`
   - in `seen` → `modified`
4. **Rate ceiling** — more than 500 events in a 10s window puts the folder into collapsed mode:
   one summary row per second carrying a `collapsed` count, never a silent drop. Two quiet
   ticks exit it.
5. **Emit**, then register the event with `noteFsEvent` so the attribution join can find it.

Rename detection keys on the **inode**, never the basename — a rename is precisely a change of
basename. That is also why the 500ms window is safe: an inode reappearing at a different path
*is* a rename, so widening cannot pair unrelated files.

A 1s ticker per process sweeps expired pending deletes and pushes a `status` frame to any
subscriber.

## Transcripts

Claude Code writes one JSONL file per session under `~/.claude/projects/<slug>/`, where the slug
is the project path with every non-alphanumeric character replaced by `-`. No per-project setup
is needed, and it works retroactively.

`parseLine` recognises exactly four things and skips everything else silently — the format
changes without notice:

| record | produces |
|---|---|
| `type: "assistant"`, `content[].type === "tool_use"` | one `tool` event per block, `detail.state: 'running'` |
| `type: "assistant"`, `message.usage` | a `token_usage` row (not an event) |
| `type: "user"`, `content[].type === "tool_result"` | closes the matching in-flight call |
| `type: "user"`, string content, or `last-prompt`, or a `queued_command` attachment | a `prompt` event and/or a topic update |

Only `Edit`, `Write`, `Read`, `MultiEdit` and `NotebookEdit` carry a file path — a lookup table,
not a heuristic, so an unknown tool yields no path. `Bash` is the majority of traffic and names
nothing.

**Tool calls open and close.** The `tool_use` block is written when the call *starts*; the
`tool_result` with the same id lands when it ends. So a row appears while work is in progress and
is closed later with a real duration. Rows predating this feature have no `detail.state`, which
is why `isRunning` requires `state === 'running'` — old rows must never animate.

**First tail reads the whole file.** Tailing otherwise starts at EOF and history is invisible; for
token accounting, history is the entire feature. The pass is idempotent because `token_usage.message_id`
is UNIQUE and the insert is `OR IGNORE`. `primeTopics` separately reads back over the file to
recover the current topic, so a restart doesn't blank it.

### Attribution and containment

Two different claims, deliberately kept apart:

- **Attribution** answers *who caused this*. A `claude` label requires a transcript tool call
  naming the same absolute path within **5s** (`MATCH_WINDOW`). Two candidate matches fail toward
  no label — a wrong `claude` is worse than none.
- **Containment** answers *what else was running*. A filesystem event whose timestamp falls inside
  a call's **measured** `[start, end + 2s]` interval is labelled `during-claude` and carries
  `duringToolEventId`. With several candidate intervals the label stands but the parent is null:
  "during Claude", never "during *this* call".

Containment never upgrades to `claude`, and the path join always outranks containment. A call
whose duration was never observed has no interval and contains nothing.

The `recent` buffer that both use is pruned to 30s **or the oldest still-open call, whichever is
older** — a Bash running a test suite routinely exceeds 30s, and evicting its changes would lose
exactly the long calls where nesting matters most. `MAX_RECENT` (2000) is the memory backstop.

### Topics

The topic is the operator's prompt, verbatim, first line, capped at 160 characters. It is sliced
by character count and never by meaning; nothing in this system summarises.

`isOperatorPrompt` filters Claude Code's own plumbing, which arrives on the same record shape as
a real prompt. `/compact` alone emits four such records. They are matched on their wrapper tags
(`<command-name>`, `<local-command-stdout>`, …) rather than on the prose inside, because the tags
are structure and the wording is not.

Mid-turn interjections never produce a `last-prompt` record — they arrive as a `queued_command`
attachment, and are picked up there.

## Boot

`server.listen` runs, in order:

1. `sweepRetention(30)` — drop events older than 30 days
2. `closeOrphanedRunning()` — in-flight tool calls from before the restart become `unknown`,
   never `done`: their results were written before tailing resumed at EOF, so we cannot know how
   they ended. Left alone they would claim to be running forever and pulse the whole tree.
3. start a watcher and a tailer per enabled folder
4. start the 1s status ticker

## Frontend

Vite + React + Tailwind + shadcn/ui, stock dark theme.

```
web/src/App.tsx              sidebar, folder selection, Workspace layout
web/src/hooks/StreamProvider one EventSource per folder, shared by every consumer
web/src/features/*           one concern per file; pure logic in .ts, UI in .tsx
web/src/lib/api.ts           typed fetch wrapper over every route
web/src/i18n/                t() + Intl formatters, one en.json bundle
web/src/components/ui/       shadcn components, unmodified
```

`StreamProvider` holds a 2000-event ring buffer (`config.bufferLimit`), counts what it evicts, and
reconnects with exponential backoff capped at 30s. The buffer lives in a ref because setState
updaters must be pure and eviction has to be counted.

Three views over the same events — a *view switch*, not a filter, so it stays in the feed column
while the collapsible filter area holds tabs, kind chips, path glob and time window:

- **Timeline** — chronological, with vertical dashes measuring real seconds between rows, so a
  stall has height. Filesystem rows nest under the tool call whose interval contained them.
- **By topic** — grouped under the operator's prompt.
- **By file** — every file ranked by last change, shaded by churn. Files never witnessed changing
  still appear, ranked by the filesystem's mtime, with a dash rather than a zero.

The right column is the heat tree. Heat is measured in **events ago, not seconds** — nothing
decays on a timer, so a branch dims only because other branches changed. A burst is stamped once
on its directory (`collapseBursts`, the same function the feed uses) so a git worktree checkout
reads as one action rather than 500.

All colour ramps go through `web/src/features/gradient.ts`. A new ramp is a list of stops, never
new interpolation code. Two ramps that can appear together must not share a hue family, and there
are tests asserting they stay disjoint.
