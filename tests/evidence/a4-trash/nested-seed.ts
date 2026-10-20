// Adds Trip ideas › Kyoto › Ryokan and Trip ideas › Packing (each with its card in the parent) to a copy of a
// database, for the nested-page browser check.   node tests/evidence/a4-trash/nested-seed.ts <workspace.sqlite>
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'

const repo = new SqliteWorkspaceRepository(process.argv[2]!)
const exec = async (action: Action) => { const ws = await repo.load(); await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action }) }
await exec({ type: 'create-document', title: 'Trip ideas', body: '', pageId: 'trip' })
for (const [id, title, parent] of [['kyoto', 'Kyoto', 'trip'], ['ryokan', 'Ryokan shortlist', 'kyoto'], ['packing', 'Packing', 'trip']]) {
  await exec({ type: 'create-document', title, body: '', pageId: id, parentId: parent })
  const ws = await repo.load(), p = ws.pages.find(x => x.id === parent)!
  await exec({ type: 'save-editor', pageId: parent, expectedContent: pageContentKey(p), document: JSON.stringify([...editorSeed(p, ws), { id: `card-${id}`, type: 'pageLink', props: { pageId: id } }]) })
}
console.log('seeded trip › kyoto › ryokan, trip › packing')
