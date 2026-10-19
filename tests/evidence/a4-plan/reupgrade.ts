// Raw-SQL stand-in for migration 4 on a downgraded copy: put the held rows back as trashed after existing positions.
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.argv[2]!)
db.exec(`BEGIN IMMEDIATE; ALTER TABLE pages ADD COLUMN "trashedAt" TEXT; ALTER TABLE pages ADD COLUMN "trashId" TEXT;`)
const clash = db.prepare(`SELECT h.id FROM held_trash_l4 h JOIN pages p ON p.id=h.id`).all()
if (clash.length) { db.exec('ROLLBACK'); throw new Error(`held pages exist again: ${clash.map(r => r.id)}`) }
const columns = (db.prepare('PRAGMA table_info(pages)').all() as { name: string }[]).map(c => `"${c.name}"`).join(',')
const last = Number(db.prepare(`SELECT COALESCE(MAX(position),-1) AS m FROM pages WHERE snapshot='current'`).get()!.m)
db.exec(`UPDATE held_trash_l4 SET position=position+${last + 1}; INSERT INTO pages (${columns}) SELECT ${columns} FROM held_trash_l4; DROP TABLE held_trash_l4; PRAGMA user_version=4; COMMIT`)
for (const r of db.prepare(`SELECT title, parentId, trashId FROM pages WHERE snapshot='current' AND title IN ('佛卡夏披萨','Dough notes')`).all()) console.log(r.title, '| parent', r.parentId ?? 'top level', '| trash', r.trashId ?? 'live')
db.close()
