// Lead e7ab12dc points 3-5, on a copy of Brian's database. With today's code (layout 3) add a task written in
// 佛卡夏披萨 and a subpage of it; then, in raw SQL standing in for the candidate, trash 佛卡夏披萨 (batch op1) with the
// subpage restored on its own (live, top level: parentId cleared, as restore-page does when the parent is in trash),
// and run the down-script. The database is left downgraded for today's built app to open.
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { DatabaseSync } from 'node:sqlite'
const path = process.argv[2]!
const repo = new SqliteWorkspaceRepository(path)
let ws = await repo.load()
const focaccia = ws.pages.find(p => p.title === '佛卡夏披萨')!
const run = async (action: any) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
await run({ type: 'add-task', pageId: focaccia.id, sectionId: focaccia.sections[0]!.id, title: 'Buy rosemary for focaccia' })
await run({ type: 'create-document', title: 'Dough notes', body: '', pageId: 'dough-notes', parentId: focaccia.id })
const db = new DatabaseSync(path)
db.exec('BEGIN IMMEDIATE; ALTER TABLE pages ADD COLUMN "trashedAt" TEXT; ALTER TABLE pages ADD COLUMN "trashId" TEXT; PRAGMA user_version=4; COMMIT')
db.exec(`UPDATE pages SET trashedAt='2026-10-20T00:00:00Z', trashId='op1', present=json_insert(present,'$[#]','trashedAt','$[#]','trashId') WHERE id='${focaccia.id}'`)
db.exec(`UPDATE pages SET parentId=NULL, present=(SELECT json_group_array(value) FROM json_each(pages.present) WHERE value<>'parentId') WHERE id='dough-notes'`)
const columns = (db.prepare('PRAGMA table_info(pages)').all() as { name: string }[]).map(c => `"${c.name}"`).join(',')
const tables = ['pages', 'tasks', 'placements', 'events', 'materials', 'captures', 'receipts']
db.exec(`BEGIN IMMEDIATE;
  CREATE TABLE held_trash_l4 AS SELECT ${columns} FROM pages WHERE snapshot='current' AND trashedAt IS NOT NULL;
  DELETE FROM pages WHERE trashedAt IS NOT NULL;
  UPDATE pages SET present=(SELECT json_group_array(value) FROM json_each(pages.present) WHERE value NOT IN ('trashedAt','trashId'));
  ${tables.map(t => `DELETE FROM ${t} WHERE snapshot='undo';`).join(' ')}
  DELETE FROM meta WHERE snapshot='undo'; UPDATE meta SET undoOperationId=NULL, undoRevision=NULL WHERE snapshot='current';
  ALTER TABLE pages DROP COLUMN "trashId"; ALTER TABLE pages DROP COLUMN "trashedAt"; PRAGMA user_version=3; COMMIT`)
console.log('downgraded; held:', db.prepare('SELECT title FROM held_trash_l4').all().map(r => r.title), '| focaccia id', focaccia.id)
db.close()
