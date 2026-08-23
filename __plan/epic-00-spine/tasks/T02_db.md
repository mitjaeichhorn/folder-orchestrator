# T02 — db.js

## What
The sqlite layer: schema creation, folder CRUD, event insert and query.

## Dependencies
- Types: `Event`, `Folder` — from `__documentation/source-of-truth/event-contract.md`
- Services: `node:sqlite` `DatabaseSync`, `node:path`, `node:fs` (`statSync` for path validation)
- Primitives: none
- Context: none
- Platform: none

## Files
- Create: `server/db.js`, `server/schema.sql`

## How
`schema.sql` is the contract doc's DDL **verbatim** — copy it, do not retype it.
`open(path)` → `DatabaseSync`, `db.exec(schema)` (all statements `IF NOT EXISTS`), return handle.
Exports: `listFolders()`, `addFolder({path,name,ignore})`, `patchFolder(id,fields)`,
`removeFolder(id,purge)`, `insertEvent(e)`, `listEvents({folderId,limit=200,before})`,
`sweepRetention(days=30)`.
All statements prepared via `db.prepare`, bound parameters only — no string interpolation into SQL.
`addFolder`: `statSync(path).isDirectory()` or throw `{code:'ENOTDIR_OR_MISSING'}`; unique path
violation surfaces as `{code:'DUPLICATE'}`. Folder id: `crypto.randomUUID()`.
`detail` is `JSON.stringify`d on write and parsed on read — callers see objects, never strings.

## Definition of Done
- [ ] Opening the same file twice does not throw (idempotent schema)
- [ ] Every `kind` from the contract round-trips with `detail` intact
- [ ] `listEvents` returns newest-first and honours `limit` and `before`
- [ ] Duplicate path → `DUPLICATE`; non-directory → `ENOTDIR_OR_MISSING`; nothing inserted either way
- [ ] `sweepRetention(30)` deletes a 31-day-old row and keeps a 29-day-old one
- [ ] `grep -n '\${' server/db.js` finds no interpolation inside a SQL string

## Activation Task
`node -e "import('./server/db.js').then(async m=>{const d=m.open('data/t.db');console.log(m.listFolders(d))})"`
prints `[]` and creates `data/t.db` with both tables.
