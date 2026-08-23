# Source of truth: the Event contract

Every epic reads this before implementation. If an epic contradicts this file, this file wins
until explicitly revised here. Changing this file is a contract change — see Epic 00.

## One event shape for everything

Filesystem changes and Claude Code tool calls are the **same row type**. There is no second
pipeline. `kind` discriminates.

```js
{
  id:         Number,   // sqlite rowid
  folderId:   String,   // stable id of the watched folder
  ts:         Number,   // epoch ms, from the source (fs stat / transcript timestamp)
  kind:       'created' | 'modified' | 'deleted' | 'renamed' | 'tool' | 'prompt' | 'alert',
  path:       String | null,   // POSIX, relative to folder root. null for 'prompt'
  actor:      'claude' | 'during-claude' | 'external' | 'unknown',
  sessionId:  String | null,   // Claude session uuid when known
  tool:       String | null,   // 'Edit' | 'Bash' | ... for kind === 'tool'
  topic:      String | null,   // the operator's prompt, verbatim — see below
  duringToolEventId: Number | null,  // events.id of the containing tool call — see invariant 6
  detail:     Object           // free-form, see below. Stored as JSON text.
}
```

### `detail` by kind

| kind | fields |
|---|---|
| `created` / `modified` | `size`, `mtime` |
| `deleted` | — |
| `renamed` | `oldPath` |
| `tool` | `input` (raw tool input), `exitCode?`, `durationMs?`, `linesAdded?`, `linesRemoved?` |
| `prompt` | `text` (first 200 chars) |

Unknown fields are allowed. Consumers must ignore what they do not recognise.

## SQLite schema

```sql
CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  path       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  ignore     TEXT NOT NULL DEFAULT '[]',   -- JSON array of glob strings
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY,
  folder_id  TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  path       TEXT,
  actor      TEXT NOT NULL DEFAULT 'unknown',
  session_id TEXT,
  tool       TEXT,
  topic      TEXT,
  during_tool_event_id INTEGER,   -- nullable, no FK: retention may delete the parent
  detail     TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX events_folder_ts ON events (folder_id, ts DESC);
```

## HTTP surface

Nothing is authenticated. The server binds `127.0.0.1` only. There are no users.

| Method | Route | Returns |
|---|---|---|
| GET  | `/api/folders` | `Folder[]` |
| POST | `/api/folders` | `Folder` — body `{path, name?, ignore?}` |
| PATCH| `/api/folders/:id` | `Folder` — body `{enabled?, ignore?, name?}` |
| DELETE | `/api/folders/:id` | `204` — stops the watcher, drops events when `?purge=1` |
| GET  | `/api/events?folder=&limit=&before=` | `Event[]`, newest first — history/backfill |
| GET  | `/api/stream?folder=` | SSE, `event: append`, `data: Event` |

SSE is the **only** push channel. Named event types on the stream:

| frame | payload | emitted by |
|---|---|---|
| `append` | one `Event` | every producer, via `emit()` |
| `patch`  | `{id, ...changedFields}` — an existing Event was relabelled or grouped | attribution join / containment sweep |
| `status` | `{folderId, watching, fileCount, eventsPerMin}`, every 2s while subscribed | Epic 01 |
| `alert`  | `{ruleId, event, actions}` | Epic 06 rule matcher |
| `ping`   | comment keepalive, every 25s | spine |

Consumers must ignore unknown frame types rather than erroring.

## `topic` — the grouping dimension above `path`

Claude Code writes a `last-prompt` record into the transcript carrying the operator's prompt
verbatim. That string **is** the topic: the tool tracks the current one per session and stamps
it onto every action that follows, plus onto any filesystem event the attribution join relabels.

Rules:
- **Transcription, never summarisation.** The topic is the exact prompt text, first line only,
  capped at 160 chars. Nothing in this system may shorten it by meaning.
- A session with no `last-prompt` seen yet has `topic: null`. Never borrow another session's.
- `topic` is a column, not a `detail` field, because it is a first-class grouping key.

The display hierarchy is therefore **topic → file → actions**. Measured on real sessions, only
**7%** of Claude tool calls declare a `file_path` (`Edit`/`Write`/`Read`/`NotebookEdit`); `Bash`
is 93% of traffic and declares none. Those group under the topic directly, in an explicit
no-file bucket — they are never assigned to whichever file happened to change nearby.

The reverse direction is what invariant 6 permits: a filesystem change may nest under the tool
call whose **measured interval contained it**. That is a claim about when, not about who, and
carries `actor: 'during-claude'` so the two can never be confused. Where containment is
ambiguous or unknown, the change stays a top-level row.

## Invariants

1. **Read-only.** No route and no module writes inside a watched folder. Ever.
2. **Filter at the source.** An ignored path never reaches SQLite, never reaches SSE. Filtering
   in the UI is a bug.
3. **Attribution is a join, never a guess.** `actor: 'claude'` requires a matching transcript
   tool call (same absolute path, within the correlation window). Otherwise `external`. When the
   path was never seen by the watcher, `unknown`. A change that merely co-occurred with a running
   tool call, without being named by it, is `during-claude` — not `claude`. See invariant 6.
4. **Unknown transcript record types are skipped silently.** The JSONL format changes without
   notice; an unrecognised `type` must never throw.
5. **No LLM.** No module in this repo calls an inference API.
6. **Attribution and grouping are different claims. Never conflate them.**

   *Attribution* answers **"who caused this?"** It is a join, never a guess (invariant 3).
   `actor: 'claude'` requires a transcript tool call naming the same absolute path within the
   correlation window. Nothing else may ever produce it.

   *Grouping* answers **"what else was happening at the same time?"** It may use **containment**,
   and only containment: a filesystem event whose timestamp falls inside a tool call's
   **measured** `[start, start + durationMs]` interval — plus a fixed grace, both endpoints
   observed, never estimated — is labelled `actor: 'during-claude'` and carries
   `duringToolEventId` so the UI can nest it under that call.

   `during-claude` states co-occurrence, not cause. It must render visibly distinct from
   `claude`, and must never be counted as a Claude action in any total, badge or metric.

   Three rules keep the two apart:
   - Containment never upgrades to `claude`. Only the path join produces `claude`.
   - The path join always outranks containment. A row attributed by the join is never
     downgraded to `during-claude`.
   - If a change falls inside more than one interval the *label* still stands — a call was
     running, that is a fact — but `duringToolEventId` is `null`. The system says "during
     Claude", never "during *this* call", when it cannot tell which.

   **Bare proximity remains forbidden**, as both parent and cause. "Near in time" without a
   measured containing interval groups nothing. A call whose duration was never observed
   (`state: 'unknown'`) has no interval and therefore contains nothing. And a tool call still
   belongs to a file only if its input named that file — `Bash` never acquires a parent file
   from whatever changed nearby.
