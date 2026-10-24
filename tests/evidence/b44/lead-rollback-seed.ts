// Lead's B44 rollback rehearsal seed: a fresh store where a kept plain link is current (a Notes line holding a URL
// plus its save-plain-link record), and a Good Stuffs line kept the same way. The live build before B44 then serves it.
//   node tests/evidence/b44/lead-rollback-seed.ts /tmp/rb-b44-<name>.sqlite
import { existsSync } from 'node:fs'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { editorSeed, inlineText, pageContentKey, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action } from '../../../src/domain/types.ts'
const path = process.argv[2]
if (!path?.startsWith('/tmp/rb-b44-') || existsSync(path)) throw Error('A new /tmp/rb-b44-* store is required')
const repo = new SqliteWorkspaceRepository(path)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const exec = async (action: Action) => { const ws = await repo.load(); return (await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action })).workspace }
let ws = await exec({ type: 'ensure-day', date: today } as Action)
const page = ws.pages.find(p => p.date === today)!
const doc = editorSeed(page, ws) as EditorNode[]
const after = (title: string) => doc.findIndex(n => n.type === 'heading' && inlineText(n.content) === title)
const link = (id: string, url: string): EditorNode => ({ id, type: 'paragraph', content: [{ type: 'link', href: url, content: url }] } as unknown as EditorNode)
const notes = after('Notes'), good = after('Good Stuffs')
const next = [...doc]
next.splice(notes + 1, 0, link('kept-notes', 'https://example.com/kept-in-notes'))
next.splice(good + 1, 0, link('kept-good', 'https://example.com/kept-in-good-stuffs'))
ws = await exec({ type: 'save-editor', pageId: page.id, expectedContent: pageContentKey(page), document: JSON.stringify(next), today } as Action)
ws = await exec({ type: 'save-plain-link', pageId: page.id, items: [{ blockId: 'kept-notes', url: 'https://example.com/kept-in-notes' }, { blockId: 'kept-good', url: 'https://example.com/kept-in-good-stuffs' }] } as Action)
console.log(JSON.stringify({ path, today, materials: ws.materials.map(m => ({ url: m.url, sources: m.sources })) }))
