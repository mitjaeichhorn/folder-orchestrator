# T03 — Watcher lifecycle

## What
`startWatch(folder)` / `stopWatch(folderId)`, plus boot-time restore of all enabled folders.

## Dependencies
- Types: `Folder`, `Event` — contract doc
- Services: `fs.watch` (`node:fs`), `normalise` (T02), `shouldIgnore` (T01),
  `emit` (Epic 00 T04), `log` (Epic 00 T03), `db.listFolders` (Epic 00 T02)
- Primitives: none
- Context: none
- Platform: macOS `fs.watch` with `{recursive:true}` — **verified on this machine (Node v25.8):
  fires for directories created after the watch starts, to arbitrary depth.** Do not add chokidar.

## Files
- Create: `server/watcher.js`

## How
`watchers = Map<folderId, {handle, seen:Set, timers:Map}>`.
`startWatch`: build the initial `seen` set with one `readdir` walk (needed so the first `modified`
is not misreported as `created`), skipping ignored subtrees; then `fs.watch(root,{recursive:true})`.
Log the walk's file count and duration.
Callback: `relPath` → `shouldIgnore` → debounce → `normalise` → `emit`.
`stopWatch`: `handle.close()`, clear all timers, drop the map entry. Idempotent.
Root deleted while watching → `stopWatch` itself, `WARN root_vanished`, `status` frame with
`watching:false`. No throw.
`fs.watch` throwing at start → folder marked not-watching with a reason, other folders unaffected.
On boot, `startWatch` every folder where `enabled = 1`.

## Definition of Done
- [ ] Boot restores watches for all enabled folders; disabled ones are not watched
- [ ] `stopWatch` releases the handle — `lsof -p $PID | grep <folder>` empty afterwards
- [ ] `stopWatch` twice does not throw
- [ ] Deleting the watched root stops the watcher and logs `root_vanished` without crashing
- [ ] A folder that fails to start leaves every other folder watching
- [ ] The initial `seen` walk skips ignored subtrees — walk time on the 21k project under 2s
- [ ] No event ever carries a path outside its folder root
- [ ] Resident memory under 150MB while watching the 21,734-file project

## Activation Task
Watch `/path/to/a/large/project`; `touch` one file in `src/`; confirm
exactly one row. Then `ps -o rss= -p $(pgrep -f 'node server')` after 10 minutes. Paste the row and
the RSS number into `../EPIC.md`.
