# Data model

The canonical Event contract lives at
[`__documentation/source-of-truth/event-contract.md`](../__documentation/source-of-truth/event-contract.md).
That file wins over any other description, including this one. This page is the working reference
and adds the tables the contract doesn't cover.

## One event shape for everything

Filesystem changes and Claude Code tool calls are the **same row type**. There is no second
pipeline. `kind` discriminates.

```ts
{
  id:        number,   // sqlite rowid
  folderId:  string,
  ts:        number,   // epoch ms, from the source (fs stat / transcript timestamp)
  kind:      'created' | 'modified' | 'deleted' | 'renamed' | 'tool' | 'prompt' | 'alert',
  path:      string | null,   // POSIX, relative to the folder root. null for 'prompt'
  actor:     'claude' | 'during-claude' | 'external' | 'unknown',
  sessionId: string | null,
  tool:      string | null,   // 'Edit' | 'Bash' | ... when kind === 'tool'
  topic:     string | null,   // the operator's prompt, verbatim
  duringToolEventId: number | null,
  detail:    object           // free-form, stored as JSON text
}
```

Unknown fields are allowed. Consumers ignore what they don't recognise.

### `detail` by kind

| kind | fields |
|---|---|
| `created` / `modified` | `size`, `mtime` |
| `deleted` | — |
| `renamed` | `size`, `mtime`, `oldPath` |
| `tool` | `input`, `state: 'running' \| 'done' \| 'error' \| 'unknown'`, `toolUseId`, `durationMs?`, `linesAdded?`, `linesRemoved?` |
| `prompt` | `text` (capped at 4096), `truncated` |
| `alert` | `ruleId`, `label`, `matched`, `actions`, `capped`, `event: {kind, path}` |

For `tool`, `detail.input` is shaped per tool: `Edit`/`MultiEdit` carry `old_string`/`new_string`
(each clipped to 4096 chars, with a `truncated` flag), `Bash` carries `command` and
`description`, path-bearing tools carry `file_path`.

A rate-ceiling summary row is a `modified` event with `path: null` and `detail.collapsed: n`.

### What each `actor` value actually claims

| value | what is known |
|---|---|
| `claude` | a tool call declared this exact path in its input. A hard join. |
| `during-claude` | the change landed inside a call's **measured** interval. A call was running; we do not claim it was that call's doing. |
| `external` | nothing was in flight — an editor, a formatter, `git checkout` |
| `unknown` | the path was never seen by the watcher, or the row is a synthetic summary |

Roughly **7%** of Claude tool calls name a file. That measurement is why `during-claude` exists:
before it, 220 of 221 filesystem events were labelled `external` and the dashboard reported a
human making changes the agent had just made.

## SQLite schema

`server/schema.sql`, applied idempotently on `db.open`.

### `folders`

| column | type | notes |
|---|---|---|
| `id` | TEXT PK | |
| `path` | TEXT UNIQUE | absolute, no trailing slash |
| `name` | TEXT | display name, defaults to the basename |
| `ignore` | TEXT | JSON array of glob strings |
| `enabled` | INTEGER | 0 stops the watcher and the tailer |
| `created_at` | INTEGER | epoch ms |

### `events`

Columns mirror the Event shape above; `detail` is JSON text and
`during_tool_event_id` is nullable **with no foreign key on purpose** — retention may delete the
parent, and a dangling pointer must degrade to "renders flat", never to a constraint error.

Index: `events_folder_ts ON events (folder_id, ts DESC)`.

### `token_usage`

Separate from the event stream: 500+ usage rows per session would drown the feed.

| column | notes |
|---|---|
| `message_id` | **UNIQUE**; inserts are `OR IGNORE`, so re-reading a transcript never double-counts |
| `input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read`, `cache_creation` | straight from `message.usage` |
| `topic` | the topic active when the message was written — this is the join that answers "which task cost the most" |

Index: `usage_folder_topic ON token_usage (folder_id, topic)`.

### `rules`

`kinds` and `actions` are JSON arrays; an empty `kinds` matches every kind. `folder_id` is
nullable and means "all folders". `threshold_count` + `threshold_seconds` together make the rule
fire only on N matches inside a window.

`PRAGMA user_version` marks the default rules as seeded. A row count can't tell "never seeded"
from "seeded then deleted", and re-seeding rules the operator deleted is worse than not seeding.

## Invariants

1. **Read-only.** No route and no module writes inside a watched folder. Ever.
2. **Filter at the source.** An ignored path never reaches SQLite and never reaches SSE. Filtering
   in the UI is a bug.
3. **Attribution is a join, never a guess.**
4. **Unknown transcript record types are skipped silently.** An unrecognised `type` must never throw.
5. **No LLM.** No module in this repo calls an inference API.
6. **Attribution and grouping are different claims.** Containment never upgrades to `claude`; the
   path join always outranks containment; ambiguous containment keeps the label and drops the
   parent. Bare proximity groups nothing.

## Ignore rules

Applied in this order, in `server/ignore.js`:

1. `DENY_DIRS` — `node_modules`, `.git`, `dist`, `build`, `.next`, `.vite`, `coverage`, `.turbo`, `vendor`
2. `DENY_GLOBS` — `*.log`, `*.swp`, `*~`, `.DS_Store`, `*.tmp`, `*.tmp.*`, `.*.swp`, `*.crswap`,
   `.!*!*`, `.goutputstream-*`, `*.sb-*` (atomic-save artifacts: the temp file is an
   implementation detail of a save, not a change the operator made)
3. the folder's `.gitignore`
4. the folder's own `ignore` list

Steps 3 and 4 use gitignore semantics — last match wins, `!` negates.

These are load-bearing, not a preference: a real project here is 21,734 files, 14,978 excluding
`node_modules` and `.git`.
