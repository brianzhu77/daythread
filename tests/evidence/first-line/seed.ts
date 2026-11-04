// A disposable store for Backspace on a page's first line (Brian, Nov 3): each kind of line first, a to-do, and today's page.
// Usage: node tests/evidence/first-line/seed.ts <store-path>

const { SqliteWorkspaceRepository } = await import('../../../src/server/sqlite-repository.ts')
const { pageContentKey } = await import('../../../src/domain/editor-document.ts')
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: any) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const today = new Date().toLocaleDateString('en-CA', { timeZone: ws.timezone })
const line = (id: string, type: string, text: string) => ({ id, type, props: {}, content: text ? [{ type: 'text', text, styles: {} }] : [], children: [] })
const doc = (pageId: string, nodes: unknown[]) => run({ type: 'save-editor', pageId, expectedContent: pageContentKey(ws.pages.find((p: any) => p.id === pageId)), document: JSON.stringify(nodes), today })
for (const [pageId, first] of [['bw', line('b1', 'bulletListItem', 'Bullet words')], ['be', line('b1e', 'bulletListItem', '')], ['nw', line('n1', 'numberedListItem', 'Numbered words')], ['cw', line('c1', 'checkListItem', 'Check words')], ['hw', line('h1', 'heading', 'Heading words')]] as const) {
  await run({ type: 'create-document', title: `T ${pageId}`, body: '', pageId })
  await doc(pageId, [first, line(`${pageId}2`, 'paragraph', 'Second line')])
}
await run({ type: 'create-document', title: 'T tw', body: '', pageId: 'tw' })
await run({ type: 'add-task', pageId: 'tw', title: 'Task words', plannedOn: null })
await run({ type: 'create-document', title: 'T te', body: '', pageId: 'te' })
await run({ type: 'ensure-day', date: today })
const dayId = ws.pages.find((p: any) => p.date === today).id
await doc(dayId, [line('d1', 'bulletListItem', 'Day bullet'), line('d2', 'paragraph', 'Day second')])
console.log('seeded', ws.pages.length, dayId)
