// EXPERIMENT (A11 plan, not for main): a `[[` link carrying a lineId, saved through save-editor on a COPY.
import { resolve } from 'node:path'
import { getRepository } from '../src/server/storage.ts'
import { editorSeed, needsTemplateRows, pageContentKey, type EditorNode } from '../src/domain/editor-document.ts'
import type { Action } from '../src/domain/types.ts'
const path = process.env.DAYTHREAD_SQLITE_PATH
if (!path || resolve(path).split('/').includes('.daythread-local')) process.exit(2)
const repository = getRepository()
const run = async (action: Action) => { const { revision } = await repository.load(); return (await repository.execute({ operationId: `exp:${crypto.randomUUID()}`, expectedRevision: revision, action })).workspace }
let ws = (await repository.load()).workspace ?? (await repository.load())
// @ts-ignore
ws = (await repository.load())
const w = ws as unknown as import('../src/domain/types.ts').Workspace
const day = w.pages.find(p => p.type === 'daily' && p.date === '2026-10-18')!
const target = w.pages.find(p => p.title === '韩国大酱汤')!
const targetLine = target.sections.flatMap(s => s.blocks).find(b => b.text.trim())!
const doc = editorSeed(day, w, { templateRows: needsTemplateRows(day, '2026-10-21') }) as EditorNode[]
const notes = doc.findIndex(n => n.id === day.sections.find(s => s.kind === 'notes')!.id)
doc.splice(notes + 1, 0, { id: crypto.randomUUID(), type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'line link: ', styles: {} }, { type: 'pageRef', props: { pageId: target.id, refId: crypto.randomUUID(), newTitle: '', lineId: targetLine.id } }], children: [] } as unknown as EditorNode)
const after = await run({ type: 'save-editor', pageId: day.id, expectedContent: pageContentKey(day), document: JSON.stringify(doc), today: '2026-10-21' })
const saved = after.pages.find(p => p.id === day.id)!
console.log(JSON.stringify({ saved: saved.editorJSON!.includes('"lineId"'), refs: saved.sections.flatMap(s => s.blocks).find(b => b.text.startsWith('line link'))?.refs, targetLine: targetLine.id }))
