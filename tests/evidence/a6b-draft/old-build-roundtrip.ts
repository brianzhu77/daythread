// A6b plan §4a / §9 rollback: with today's draft in each status written by the new build, the live build 53c1b83
// (its own repository and domain, from its checkout) opens the file, edits that day's page and Undoes the edit. A row
// made from a proposal keeps its source fields through the old build's save. The new build then reads it all back.
//   node old-build-roundtrip.ts <checkout of 53c1b83> <work dir>
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { SqliteWorkspaceRepository as NewRepo } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, inlineText, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import { fingerprintOf, isLineLinked } from '../../../src/domain/draft.ts'
import type { Workspace } from '../../../src/domain/types.ts'

const [oldTree, work] = process.argv.slice(2).map(p => resolve(p!))
const Old = await import(join(oldTree!, 'src/server/sqlite-repository.ts'))
const oldDoc = await import(join(oldTree!, 'src/domain/editor-document.ts'))
type Repo = { load(): Promise<Workspace>; execute(c: unknown): Promise<{ workspace: Workspace }> }
const exec = async (repo: Repo, action: object, operationId: string = crypto.randomUUID()) => { const ws = await repo.load(); return (await repo.execute({ operationId, expectedRevision: ws.revision, action })).workspace }
const check = (name: string, fn: () => void) => { fn(); console.log(`ok   ${name}`) }
const D = '2026-10-19'

for (const status of ['drafting', 'ready', 'failed', 'expired'] as const) {
  const db = join(work!, `${status}.sqlite`)
  const repo = new NewRepo(db, '/nonexistent.json', { allowMissingLegacy: true })
  let ws = await exec(repo, { type: 'ensure-day', date: '2026-10-18' })
  const sun = ws.pages[0]!
  const doc = editorSeed(sun, ws), at = doc.findIndex(n => n.type === 'heading' && inlineText(n.content) === 'Notes')
  ws = await exec(repo, { type: 'save-editor', pageId: sun.id, expectedContent: pageContentKey(sun), document: JSON.stringify([...doc.slice(0, at + 1), { id: 'n1', type: 'paragraph', content: '明天给 Kevin 回电话' }, ...doc.slice(at + 1)]) })
  ws = await exec(repo, { type: 'ensure-day', date: D })
  ws = await exec(repo, { type: 'start-draft-run', date: D, model: 'fake/model', startedAt: '2026-10-19T16:00:00Z' }, 'r1')
  const block = ws.pages.find(p => p.id === sun.id)!.sections.flatMap(s => s.blocks).find(b => b.id === 'n1')!
  const line = { lineId: `${sun.id}/n1`, pageId: sun.id, blockId: 'n1', fingerprint: fingerprintOf(ws, ws.pages.find(p => p.id === sun.id)!, block) }
  ws = await exec(repo, { type: 'record-draft-request', date: D, runId: 'r1', requestHash: 'h', manifest: { lines: [line], sentPages: [sun.id], omittedPages: [], taskCandidates: [], materialCandidates: [] } })
  if (status === 'ready') {
    ws = await exec(repo, { type: 'set-model-draft', date: D, runId: 'r1', taskIds: [], materialIds: [], proposals: [{ ...line, date: D }] })
    ws = await exec(repo, { type: 'add-proposal', date: D, lineId: line.lineId })
  }
  if (status === 'failed' || status === 'expired') ws = await exec(repo, { type: 'model-draft-failed', date: D, runId: 'r1', failure: 'unavailable', expired: status === 'expired' })
  const before = JSON.stringify(ws.pages.find(p => p.date === D)!.draft)

  // The live build: open, edit that day's page, Undo the edit.
  const old: Repo = new Old.SqliteWorkspaceRepository(db, '/nonexistent.json', { allowMissingLegacy: true })
  let o = await old.load()
  const mon = o.pages.find(p => p.date === D)!
  const seed: EditorNode[] = oldDoc.editorSeed(mon, o)
  o = await exec(old, { type: 'save-editor', pageId: mon.id, expectedContent: oldDoc.pageContentKey(mon), document: JSON.stringify([...seed, { id: 'old-edit', type: 'paragraph', content: 'typed in 53c1b83' }]) }, `old-edit-${status}`)
  check(`${status}: 53c1b83 opens it and saves an edit`, () => assert.ok(o.pages.find(p => p.date === D)!.sections.some(s => s.blocks.some(b => b.text === 'typed in 53c1b83'))))
  o = await exec(old, { type: 'undo', targetOperationId: `old-edit-${status}` })
  check(`${status}: 53c1b83 Undoes it`, () => assert.ok(!o.pages.find(p => p.date === D)!.sections.some(s => s.blocks.some(b => b.text === 'typed in 53c1b83'))))
  // One more old-build save, kept, so a proposal row goes through its save path.
  const mon2 = o.pages.find(p => p.date === D)!
  o = await exec(old, { type: 'save-editor', pageId: mon2.id, expectedContent: oldDoc.pageContentKey(mon2), document: JSON.stringify([...oldDoc.editorSeed(mon2, o), { id: 'old-keep', type: 'paragraph', content: 'kept from 53c1b83' }]) })

  // The new build reads it back.
  const back = await new NewRepo(db).load()
  const page = back.pages.find(p => p.date === D)!
  check(`${status}: the new build reads the draft back unchanged`, () => assert.equal(JSON.stringify(page.draft), before))
  check(`${status}: and the old build's kept line`, () => assert.ok(page.sections.some(s => s.blocks.some(b => b.text === 'kept from 53c1b83'))))
  // As for A8's brought lines, an editor save (either build) re-projects the row without the source fields, and the
  // record lives on in editorBlockMetadata, which is what isLineLinked reads.
  if (status === 'ready') check('ready: after 53c1b83 saved the page, the accepted record survives in block metadata and the line stays linked', () => {
    const row = Object.values(page.editorBlockMetadata ?? {}).find(b => b.sourceBlockId === 'n1')!
    assert.deepEqual([row.sourcePageId, row.sourceBlockId, row.sourceFingerprint], [sun.id, 'n1', line.fingerprint])
    assert.equal(isLineLinked(back, sun.id, 'n1'), true)
  })
}
console.log('all checks passed')
