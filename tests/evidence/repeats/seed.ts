// A disposable store for repeating templates (R4-6): Log with a Weekly review template that has a to-do and a value.
// Usage: node tests/evidence/repeats/seed.ts <store-path> [none|week|missed|every|paused|days|later]
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageContentKey } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
if (!process.argv[2]) { console.error('Usage: node tests/evidence/repeats/seed.ts <store-path> [none|week|missed|every|paused|days|later] (a throwaway SQLite file, never his data)'); process.exit(2) }
const repo = new SqliteWorkspaceRepository(process.argv[2]!, undefined, { allowMissingLegacy: true })
let ws = await repo.load()
const run = async (action: Action) => { ws = (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
const today = new Date().toLocaleDateString('en-CA', { timeZone: ws.timezone })
const weeksAgo = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 7 * 86_400_000).toISOString().slice(0, 10)
const kind = process.argv[3] ?? 'none'
await run({ type: 'create-database', pageId: 'log', homeBlockId: null, title: 'Log' })
await run({ type: 'change-database', pageId: 'log', change: { kind: 'addProperty', property: { id: 'score', name: 'Score', type: 'number' } } })
await run({ type: 'create-template', databaseId: 'log', title: 'Weekly review', pageId: 'weekly' })
const t = ws.pages.find(p => p.id === 'weekly')!
await run({ type: 'save-editor', pageId: 'weekly', expectedContent: pageContentKey(t), document: JSON.stringify([{ id: 'tl', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'What went well', styles: {} }], children: [] }]), today })
if (kind !== 'none') await run({ type: 'change-database', pageId: 'log', change: { kind: 'setRepeat', templateId: 'weekly', repeat: { every: 'week', interval: 1, start: kind === 'week' || kind === 'later' ? today : weeksAgo(3), time: kind === 'later' ? '09:00' : '00:00', ...(kind === 'days' ? { weekdays: [0, 1, 2, 3, 4, 5, 6] } : {}), ...(kind === 'every' ? { everyMissed: true as const } : {}), ...(kind === 'paused' ? { paused: true as const } : {}) } } })
console.log('seeded', process.argv[2], today)
