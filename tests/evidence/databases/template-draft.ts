// R2-6 on a copy of his data: the same day with and without views in his Day template. The model is sent the same words,
// a draft lands in the same slots, and Apply, Undo and carry-over come out the same.
// Usage: node tests/evidence/databases/template-draft.ts <copy-store-path> <scratch-dir>  (reads the copy, writes only in the scratch dir)
import { copyFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { buildDayDraftRequest, draftCandidates, withFallback } from '../../../src/server/model/day-draft.ts'
import { flatNodes, inlineText, pageNodes, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action, Page } from '../../../src/domain/types.ts'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/template-draft.ts <copy-store-path> <scratch-dir>'); process.exit(2) }
const [copy, scratch] = process.argv.slice(2) as [string, string]
const date = '2026-12-21', next = '2026-12-22'
const anyIds = (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'ID')
const shape = (nodes: EditorNode[]) => nodes.filter(n => n.type !== 'database').map(n => `${n.type}:${inlineText(n.content).trim()}`)

async function run(variant: 'plain' | 'viewed') {
  const path = `${scratch}/draft-${variant}.sqlite`
  execSync(`rm -f ${path} ${path}-wal ${path}-shm`)
  copyFileSync(copy, path)
  execSync(`node tests/evidence/databases/seed-table.ts ${path}`, { stdio: 'ignore' })
  execSync(`node tests/evidence/databases/template-view-seed.ts ${path} ${variant === 'plain' ? 'plain' : ''}`, { stdio: 'ignore' })
  const repo = new SqliteWorkspaceRepository(path)
  let ws = await repo.load()
  const exec = async (action: Action) => { const r = await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }); ws = r.workspace; return r.receipt }
  const page = (d = date) => ws.pages.find(p => p.date === d) as Page
  const doc = () => flatNodes(pageNodes(page()))
  const request = buildDayDraftRequest(ws, page())
  const views = doc().filter(n => n.type === 'database').length
  // A draft as the model's reply becomes one: the first open tasks into the first empty slots, the rest by the fallback.
  const candidates = draftCandidates(ws, page()), slots = doc().filter(n => n.type === 'task' && !inlineText(n.content).trim())
  let n = 0
  const fills = candidates.slice(0, Math.min(2, slots.length)).map((t, i) => ({ id: `fill${i}`, anchor: slots[i]!.id, place: 'fill' as const, taskId: t.id, source: 'model' as const, state: 'open' as const }))
  const { items, moreOpen } = withFallback(ws, page(), fills, () => `fb${n++}`)
  await exec({ type: 'set-draft', pageId: page().id, status: 'ready', items, moreOpen, allowedTaskIds: candidates.map(t => t.id) })
  const before = shape(doc()), tasks = ws.tasks.length
  const receipt = await exec({ type: 'apply-draft', pageId: page().id, itemIds: items.map(i => i.id), today: date })
  const applied = shape(doc())
  await exec({ type: 'undo', targetOperationId: receipt.operationId })
  const undone = shape(doc())
  await exec({ type: 'apply-draft', pageId: page().id, itemIds: items.map(i => i.id), today: date })
  await exec({ type: 'ensure-day', date: next })
  const carried = shape(flatNodes(pageNodes(page(next))))
  return { views, messages: anyIds(JSON.stringify(request.messages)), anchorsAView: [...request.blocks.values()].some(b => b.type === 'database'), candidates: candidates.length, items: items.length, before, applied, undone, carried, tasksMade: ws.tasks.length - tasks, viewsNext: flatNodes(pageNodes(page(next))).filter(b => b.type === 'database').length }
}

const plain = await run('plain'), viewed = await run('viewed')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const checks = {
  viewsOnTheDay: viewed.views === 2 && plain.views === 0,
  sameWordsToTheModel: viewed.messages === plain.messages,
  noViewAsAnchor: !viewed.anchorsAView,
  sameDayBefore: same(viewed.before, plain.before),
  sameAfterApply: same(viewed.applied, plain.applied),
  undoPutsItBack: same(viewed.undone, viewed.before) && same(viewed.undone, plain.undone),
  sameCarryOver: same(viewed.carried, plain.carried),
  sameTasks: viewed.tasksMade === plain.tasksMade,
  draftChangedTheDay: viewed.items > 0 && !same(viewed.applied, viewed.before),
  viewsOnTheNextDay: viewed.viewsNext === 2,
}
console.log(JSON.stringify({ candidates: viewed.candidates, items: viewed.items, checks }))
const ok = Object.values(checks).every(Boolean)
if (!ok) for (const k of ['before', 'applied', 'undone', 'carried'] as const) if (!same(viewed[k], plain[k])) console.log(k, JSON.stringify(plain[k]).slice(0, 800), '\n', JSON.stringify(viewed[k]).slice(0, 800))
console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
