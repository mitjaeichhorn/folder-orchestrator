# Running and operating it

macOS only, Node 25+ (for `node:sqlite`), localhost, one operator.

`fs.watch` recursive does not exist on Linux and this leans on it entirely. That is a deliberate
non-goal, not a gap.

## First run

```bash
npm --prefix web install
npm --prefix web run build
ORCH_DB=data/live.db npm start
```

Open <http://127.0.0.1:4000> and add a folder — the **Add folder** button opens the native macOS
picker on the host.

Development, with hot reload on the frontend:

```bash
npm start                      # server on :4000
npm run dev                    # vite on :5173, VITE_API_BASE=http://127.0.0.1:4000
```

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `ORCH_PORT` | `4000` | HTTP port. The host is always `127.0.0.1` and is not configurable. |
| `ORCH_DB` | `./data/orchestrator.db` | SQLite file |
| `ORCH_LOG_DIR` | `./logs` | Where `orchestrator.jsonl` is written |
| `ORCH_DEBUG` | unset | `1` enables `DEBUG` log lines (per-event normalise and emit) |
| `ORCH_CLAUDE_DIR` | `~/.claude/projects` | Transcript root. Mainly for tests. |

Frontend, build-time:

| Variable | Default | Effect |
|---|---|---|
| `VITE_API_BASE` | `''` (same origin) | API origin, needed when running the Vite dev server |
| `VITE_LOCALE` | `en` | Drives `Intl` formatting. There is one bundle; the locale is still configuration, never a constant. |

## Logs

JSONL at `$ORCH_LOG_DIR/orchestrator.jsonl`, one object per line:
`{ ts, level, code, ...fields }`. Rotated at 10 MB, three generations kept. A log the process
cannot write produces one line on stderr and is then dropped — a localhost tool that can't write
its log should say so once and keep serving.

Codes worth grepping:

| code | means |
|---|---|
| `boot` | startup: port, db path, folder count, retention deletions, orphans closed |
| `watch_started` / `watch_error` / `root_vanished` | watcher lifecycle |
| `rate_ceiling_enter` / `_collapse` / `_exit` | the folder exceeded 500 events / 10s |
| `attribution` / `attribution_ambiguous` | the exact-path join, with `delta_ms` and outcome |
| `contained` | a filesystem event was nested under a tool call, with the candidate count |
| `rule_fire` / `cooldown_suppressed` / `toast_cap` | alerts |
| `transcript_reset` | a transcript file was truncated or replaced; the tailer restarted at 0 |
| `file_denied` | `/api/file` refused a path, with the reason code |

## Retention

Events older than **30 days** are deleted at boot, and the count is logged as
`retention_deleted`. Nothing sweeps while the process runs. `token_usage` is not swept — it's
small, and the whole point is the historical total.

Deleting a folder without `?purge=1` leaves its events in place.

## Restarts

Tailing resumes at EOF, so a tool result written while the process was down is never seen. Boot
therefore sweeps in-flight tool calls to `state: 'unknown'`, never `done` — we cannot know how
they ended. Without that they would claim to be running forever, drag the work-in-progress window
back hours, and pulse the whole tree.

Token accounting is unaffected: the first tail of each transcript reads the whole file, and
`message_id` is UNIQUE with `OR IGNORE` inserts, so nothing is double-counted.

## Troubleshooting

**`port_in_use` on boot** — the process exits immediately. `ORCH_PORT=4001 npm start`.

**A folder shows `watching: false`** — `status.reason` carries the errno. Usually the path no
longer exists; the watcher stops itself and logs `root_vanished`.

**The sidebar rate is stuck at 0** — it polls `/api/folders` every 10s, matching the server's
`RATE_WINDOW`. A faster poll resamples the same window and shows noise rather than news.

**A change didn't appear** — check the ignore rules first. `.gitignore` is honoured, and so are
`DENY_DIRS` and `DENY_GLOBS` (see [data-model.md](data-model.md#ignore-rules)). Filtering happens
before SQLite, so an ignored path leaves no trace anywhere.

**A burst of changes came through as one row with a count** — that's the rate ceiling. Look for
`rate_ceiling_enter` in the log. Nothing was dropped silently; the count is the record.

**Repeated identical rows in the feed** — real, not a bug. A tool that writes a file then formats
it emits two genuine events ~200ms apart. The feed collapses consecutive same path+kind+actor rows
inside 2s into one carrying a count.

**Changes appear but nothing is labelled `claude`** — the transcript tailer needs
`~/.claude/projects/<slug>/`, where the slug is the folder's absolute path with every
non-alphanumeric character replaced by `-`. If the Claude Code session was started from a
different working directory, its transcript lives under a different slug.

**A code change seems to have no effect** — you may be running the previous build. `index.html` is
served `no-cache`; if you're behind a proxy that ignores that, hard-reload.

**The folder picker fails** — `PICKER_UNAVAILABLE` means no window server (headless or ssh).
Add the folder by typing the path instead.
