// Direction A (Lead 98df7dae, 1a6d490b), on a copy of Brian's database. Raw SQL stands in for the future migration
// 4 and scripts/rollback-layout-4. Candidate trashes 佛卡夏披萨 -> down-script moves the trashed current rows out of
// `pages` into a holding table, clears Undo, drops the columns, sets version 3 (one transaction) -> today's build
// opens, can't see the trashed page, edits and undoes -> migration 4 puts the held rows back as trashed, refusing
// if any held id exists again as a page.
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { DatabaseSync } from 'node:sqlite'
const path = process.argv[2]!
let db = new DatabaseSync(path)
db.exec('BEGIN IMMEDIATE; ALTER TABLE pages ADD COLUMN "trashedAt" TEXT; ALTER TABLE pages ADD COLUMN "trashId" TEXT; PRAGMA user_version=4; COMMIT')
db.exec(`UPDATE pages SET trashedAt='2026-10-20T00:00:00Z', trashId='op1', present=json_insert(present,'$[#]','trashedAt','$[#]','trashId') WHERE title='佛卡夏披萨'`)
const columns = (db.prepare('PRAGMA table_info(pages)').all() as { name: string }[]).map(c => `"${c.name}"`).join(',')
console.log('candidate trashed (current+undo):', db.prepare(`SELECT snapshot||':'||title AS x FROM pages WHERE trashedAt IS NOT NULL`).all().map(r => r.x))
// Down-script.
const tables = ['pages', 'tasks', 'placements', 'events', 'materials', 'captures', 'receipts']
db.exec(`BEGIN IMMEDIATE;
  CREATE TABLE held_trash_l4 AS SELECT ${columns} FROM pages WHERE snapshot='current' AND trashedAt IS NOT NULL;
  DELETE FROM pages WHERE trashedAt IS NOT NULL;
  ${tables.map(t => `DELETE FROM ${t} WHERE snapshot='undo';`).join(' ')}
  DELETE FROM meta WHERE snapshot='undo'; UPDATE meta SET undoOperationId=NULL, undoRevision=NULL WHERE snapshot='current';
  ALTER TABLE pages DROP COLUMN "trashId"; ALTER TABLE pages DROP COLUMN "trashedAt"; PRAGMA user_version=3; COMMIT`)
db.close()
// Today's build.
const repo = new SqliteWorkspaceRepository(path)
let ws = await repo.load()
console.log('old build opens; trashed page hidden:', !ws.pages.some(p => p.title === '佛卡夏披萨'), '| undo cleared:', !ws.undo)
const soup = ws.pages.find(p => p.title === '韩国大酱汤')!
ws = (await repo.execute({ operationId: 'old-1', expectedRevision: ws.revision, action: { type: 'rename-page', pageId: soup.id, title: '韩国大酱汤 v2' } })).workspace
ws = (await repo.execute({ operationId: 'old-2', expectedRevision: ws.revision, action: { type: 'rename-page', pageId: soup.id, title: 'oops' } })).workspace
ws = (await repo.execute({ operationId: 'old-3', expectedRevision: ws.revision, action: { type: 'undo', targetOperationId: 'old-2' } })).workspace
console.log('old build edit + undo:', ws.pages.find(p => p.id === soup.id)!.title)
if (process.argv[3] === 'stop') process.exit(0)
// Migration 4 again.
db = new DatabaseSync(path)
db.exec(`BEGIN IMMEDIATE; ALTER TABLE pages ADD COLUMN "trashedAt" TEXT; ALTER TABLE pages ADD COLUMN "trashId" TEXT;`)
const clash = db.prepare(`SELECT h.id FROM held_trash_l4 h JOIN pages p ON p.id=h.id`).all()
if (clash.length) { db.exec('ROLLBACK'); throw new Error(`held pages exist again: ${clash.map(r => r.id)}`) }
const last = Number(db.prepare(`SELECT COALESCE(MAX(position),-1) AS m FROM pages WHERE snapshot='current'`).get()!.m)
db.exec(`UPDATE held_trash_l4 SET position=position+${last + 1}; INSERT INTO pages (${columns}) SELECT ${columns} FROM held_trash_l4; DROP TABLE held_trash_l4; PRAGMA user_version=4; COMMIT`)
console.log('re-upgraded trashed:', db.prepare(`SELECT snapshot||':'||title||':'||trashId AS x FROM pages WHERE trashedAt IS NOT NULL`).all().map(r => r.x),
  '| soup title:', db.prepare(`SELECT title FROM pages WHERE snapshot='current' AND id=?`).get(soup.id)!.title)
db.close()
