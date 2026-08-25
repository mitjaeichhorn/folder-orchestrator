# HTTP and SSE reference

Base URL `http://127.0.0.1:4000` unless `ORCH_PORT` says otherwise.

**Nothing is authenticated.** The server binds `127.0.0.1` and that is the entire security model.
There are no users, no sessions and no roles — see the non-goals in
[north-star.md](../north-star.md).

Request bodies are JSON, capped at 64 KB. Errors return `{ "code": "SOME_CODE" }` with a matching
status; `413` for an oversized body, `400` for malformed JSON.

## Folders

### `GET /api/folders`
`Folder[]`, each with a live `status` block merged in.

```json
[{
  "id": "f_a1b2", "path": "/Users/me/proj", "name": "proj",
  "ignore": ["tmp/**"], "enabled": true, "createdAt": 1740000000000,
  "status": { "folderId": "f_a1b2", "watching": true, "reason": null,
              "fileCount": 4783, "eventsPerMin": 12 }
}]
```

### `POST /api/folders`
Body `{ path, name?, ignore? }`. `201` with the folder, and the watcher plus tailer start
immediately. `400 PATH_REQUIRED` when `path` is missing, `409 DUPLICATE` when the path is already
watched.

### `PATCH /api/folders/:id`
Body `{ enabled?, name?, ignore? }`. Toggling `enabled` starts or stops the watcher and the
tailer. `404 NOT_FOUND` for an unknown id.

### `DELETE /api/folders/:id[?purge=1]`
`204`. Stops the watcher. Without `purge=1` the folder's events stay in the database.

## Events

### `GET /api/events`
Newest first.

| param | meaning |
|---|---|
| `folder` | folder id |
| `limit` | default 200 |
| `before` | epoch ms, for paging backwards |
| `session` | filter to one Claude session |
| `kinds` | comma-separated list of event kinds |

### `GET /api/usage?folder=`
Token usage aggregated per topic — `messages`, `inputTokens`, `outputTokens`, `thinkingTokens`,
`cacheRead`, `cacheCreation`, `firstTs`, `lastTs`.

### `GET /api/sessions?folder=`
The 20 most recent Claude sessions: `{ id, startedAt, lastAt, events, files }`.

## Files and diffs

### `GET /api/tree?folder=`
The project tree with ignore rules applied — the same rules the watcher uses, so the heat map can
never show a path that will never light up.

```json
{ "nodes": 4783, "truncated": false, "children": [
  { "n": "src", "p": "src", "d": 1, "c": [
    { "n": "app.ts", "p": "src/app.ts", "d": 0, "m": 1740000000000, "l": 1204 }
  ]}
]}
```

`d` is 1 for a directory, `m` is mtime in epoch ms, and `l` is a line count. **`l` absent means
"not measured"** — an exempt extension, a binary, or a file too large to be worth reading — which
is not the same as "short". Capped at 12,000 nodes and 24 levels; `truncated` says so explicitly
rather than letting a partial tree read as the whole project.

### `GET /api/diff?folder=&path=`
Working-tree-vs-HEAD from git, **not** the diff of one event — later changes to the same file are
included, and the UI says so.

```json
{ "available": true, "source": "git", "against": "worktree",
  "truncated": false, "text": "diff --git ..." }
```

`against` is `worktree`, `head` or `untracked`, tried in that order. On failure:
`{ "available": false, "reason": "NOT_A_REPO" | "NO_CHANGES" | "OUTSIDE" | "BAD_PATH" | "NOT_FILE" }`.
Capped at 200 KB, `git` timeout 5s.

`Edit`/`MultiEdit` rows don't need this route — they carry `old_string`/`new_string` in
`detail.input`. Everything else does, and everything else is the majority.

### `GET /api/file?folder=&path=`
Raw bytes, **allow-list only**: images (`.png .jpg .jpeg .gif .webp .avif .svg .ico .bmp`) and
markdown (`.md .markdown .mdown .mkd`). 8 MB ceiling.

The path must resolve inside the folder, and the symlink check realpaths *both* sides — on macOS
the folder itself often sits under a symlink (`/var` → `/private/var`), and comparing a resolved
file against an unresolved root rejects everything legitimate.

Served with `Content-Security-Policy: default-src 'none'; sandbox` and `X-Content-Type-Options:
nosniff` — a served file is data, never a document with privileges.

`403` outside the folder, `404` missing, `415` extension not served, `413` too large.

## Host actions

### `POST /api/pick-folder`
Opens the native macOS folder dialog and blocks until the operator answers. Returns
`{ path }`, `{ cancelled: true }`, or `{ error }` with `501`.

The browser can't hand a server an absolute path — `showDirectoryPicker` returns a handle — but
the server runs on the same Mac. It shells out to a **fixed** AppleScript via `execFile`: no
shell, no interpolation, nothing the client sends ever reaches the script. Errors are
`UNSUPPORTED_PLATFORM`, `TIMEOUT` (120s) or `PICKER_UNAVAILABLE` (headless / ssh).

### `POST /api/reveal`
Body `{ path }`. Runs `open -R` to reveal the file in Finder. Read-only against the tree.

## Rules

`GET /api/rules`, `POST /api/rules`, `PATCH /api/rules/:id`, `DELETE /api/rules/:id`.

A rule is `{ folderId, kinds, pathGlob, thresholdCount, thresholdSeconds, actions, label, enabled }`.
Empty `kinds` matches every kind; a null `folderId` matches every folder. `400 BAD_GLOB` when
`pathGlob` isn't a string.

Seeded defaults: `.env*` changed, an event storm (100 events in 10s), and a delete under `src/`.

Each rule has a 60s cooldown, and no more than 5 alerts fire across all rules in any 10s window —
past that they carry `capped: true`. A rule that throws is disabled rather than allowed to break
the stream.

## SSE — `GET /api/stream?folder=`

The **only** push channel. On connect the server replays the last 200 events *before* subscribing,
so there is no gap at the seam, then sends one `status` frame.

| frame | payload |
|---|---|
| `append` | one Event |
| `patch` | `{ id, ...changedFields }` — an existing event was relabelled (attribution or containment) or closed |
| `status` | `{ folderId, watching, reason, fileCount, eventsPerMin }`, every 1s while subscribed |
| `alert` | delivered as an `append` with `kind: 'alert'` |
| `:ping` | comment keepalive, every 25s, one shared timer for all subscribers |

Consumers must ignore unknown frame types rather than erroring.

The client keeps a 2000-event ring buffer and reconnects with exponential backoff capped at 30s.

## Static files

Anything else is served from `web/dist`, falling back to `index.html`.

`index.html` is sent `no-cache, must-revalidate` because it names the content-hashed bundle — a
cached copy silently serves the previous build, and you end up debugging code that isn't running.
Hashed assets are `immutable`.
