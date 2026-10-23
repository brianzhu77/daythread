// B33 one-time cleanup (Jazz rule 2, Lead 764c7bf8): tasks the old delete rule left behind with no line anywhere.
// Lists the candidates; deletes only the ids passed with --apply, through the `delete-orphan-tasks` command (all or
// nothing, refused for anything with history, undoable). Take a backup of the row first.
//   DAYTHREAD_STORAGE=postgres DATABASE_URL=... node scripts/cleanup-orphan-tasks.ts                 # list only
//   DAYTHREAD_STORAGE=postgres DATABASE_URL=... node scripts/cleanup-orphan-tasks.ts --apply <id> ...
// Candidates: born on their page (the same test as the delete rule), no row on any page, and a title that is empty,
// a lone "#" or tag, or one or two Latin letters ("a", "aa": typing noise). Anything else is never listed.
import { getRepository } from '../src/server/storage.ts'
import { bornHere } from '../src/domain/workspace.ts'

const repository = getRepository()
const ws = await repository.load()
const noise = (title: string) => !title.replace(/#[^\s#]*/g, '').trim() || /^[A-Za-z]{1,2}$/.test(title.trim())
const candidates = ws.tasks.filter(t => {
  if (ws.pages.some(p => p.sections.some(s => s.blocks.some(b => b.taskId === t.id)))) return false
  const home = ws.pages.find(p => p.id === t.sourcePageId)
  return Boolean(home) && bornHere(ws, t, home!) && noise(t.title)
})
const apply = process.argv.indexOf('--apply')
if (apply < 0) {
  console.log(`revision ${ws.revision}: ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`)
  for (const t of candidates) console.log(JSON.stringify({ id: t.id, title: t.title, status: t.status, page: t.sourcePageId, placements: ws.placements.filter(x => x.taskId === t.id).map(x => `${x.date}:${x.state}`) }))
  process.exit(0)
}
const ids = process.argv.slice(apply + 1)
const unknown = ids.filter(id => !candidates.some(t => t.id === id))
if (!ids.length || unknown.length) { console.error(`Not candidates: ${unknown.join(', ') || '(none given)'}; nothing changed`); process.exit(1) }
const result = await repository.execute({ operationId: `cleanup-orphan-tasks:${ws.revision}`, expectedRevision: ws.revision, action: { type: 'delete-orphan-tasks', taskIds: ids } })
console.log(`${result.receipt.message} (revision ${ws.revision} → ${result.workspace.revision}); Undo targets ${result.receipt.operationId}`)
process.exit(0)
