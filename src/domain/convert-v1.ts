// The one-way conversion from the v1 workspace (sections, placements, events, materials, captures, five copies of a
// page) to v2 (pages with one document, tasks). Deterministic: the same input gives the same output, so a rehearsal
// on a copy proves what the cutover will write. Never mutates its input.
import { emptyLine, emptyTaskRow, flatNodes, headingNode, inlineText, isTaskRow, rowInsertIndex, rowRole, rowTaskId, templateDocument, textRun, type EditorNode } from './editor-document.ts'
import type { Page, Receipt, Task, Workspace } from './types.ts'

type V1Ref = { refId: string; pageId: string; at: number; title: string; pending?: boolean; lineId?: string; taskId?: string }
interface V1Block { id: string; kind: string; text: string; taskId?: string; planRole?: 'plan' | 'reference'; eventId?: string; materialId?: string; targetPageId?: string; at?: number; refs?: V1Ref[] }
interface V1Section { id: string; kind: string; title: string; blocks: V1Block[]; refs?: V1Ref[] }
interface V1Page { id: string; type: 'daily' | 'document'; date: string | null; title: string; url?: string | null; parentId?: string | null; trashedAt?: string | null; trashId?: string | null; sections: V1Section[]; editorJSON?: string; editorSections?: string; templateApplied?: boolean; reviewSaved?: boolean; handoffDone?: boolean; reviewText?: string }
interface V1Capture { id: string; pageId: string; text: string; status: string }
interface V1Task { id: string; title: string; status: Task['status']; version: number; plannedOn: string | null; attentionOn: string | null; deadlineOn: string | null; paused: boolean; createdOn: string; lastPlannedOn: string | null; sourcePageId: string; doneOn?: string | null }
interface V1Placement { taskId: string; date: string; state: 'included' | 'excluded' | 'moved'; order?: number; section: string }
interface V1Event { id: string; title: string; date: string; time: string | null; cancelled: boolean }
interface V1Material { id: string; url: string; title: string }
interface V1Workspace { schemaVersion: 1; revision: number; timezone: string; pages: V1Page[]; tasks: V1Task[]; events: V1Event[]; placements: V1Placement[]; materials: V1Material[]; captures: V1Capture[]; receipts: Record<string, Receipt> }

const isV1 = (raw: unknown): raw is V1Workspace => !!raw && typeof raw === 'object' && (raw as { schemaVersion?: unknown }).schemaVersion === 1 && Array.isArray((raw as V1Workspace).pages) && Array.isArray((raw as V1Workspace).tasks)
const isV2 = (raw: unknown): raw is Workspace => !!raw && typeof raw === 'object' && (raw as { schemaVersion?: unknown }).schemaVersion === 2 && Array.isArray((raw as Workspace).pages) && Array.isArray((raw as Workspace).tasks)

/** A stored workspace of either shape as v2; anything else is refused. `today` decides which never-saved day pages get template rows. */
export function upgradeWorkspace(raw: unknown, today: string): Workspace {
  if (isV2(raw)) return raw
  if (isV1(raw)) return convertV1(raw, today)
  throw new Error('Unsupported workspace shape')
}

export function convertV1(raw: unknown, today: string): Workspace {
  if (!isV1(raw)) throw new Error('Unsupported workspace shape')
  const v1 = structuredClone(raw)
  const taskById = new Map(v1.tasks.map(t => [t.id, t]))
  // A row is a plan where the task was ever planned on that day (included, or moved on since: history), never where it was set aside.
  const included = new Set(v1.placements.filter(x => x.state === 'included' || x.state === 'moved').map(x => `${x.taskId}|${x.date}`))
  const pages: Page[] = v1.pages.map(p => {
    const nodes = v1Document(p, v1)
    // Roles follow the old facts: on a day page a row is a plan where the task was placed on that day.
    for (const n of flatNodes(nodes)) {
      const id = rowTaskId(n)
      if (!id) continue
      const t = taskById.get(id)
      // A row with no task yet (an empty template row) is a plan row too: what gets typed there is planned on that day.
      const plan = p.type === 'daily' && !!p.date && (t ? included.has(`${id}|${p.date}`) || t.plannedOn === p.date : true)
      n.props = { ...n.props, role: plan ? 'plan' : 'reference', planDate: plan ? p.date! : '' }
    }
    const page: Page = { id: p.id, type: p.type, date: p.date, title: p.title, document: JSON.stringify(nodes) }
    if (p.url) page.url = p.url
    if (p.parentId) page.parentId = p.parentId
    if (p.trashedAt) { page.trashedAt = p.trashedAt; page.trashId = p.trashId ?? null }
    if (p.handoffDone) page.handoffDone = true
    if (p.reviewSaved) page.reviewSaved = true
    return page
  })
  const tasks: Task[] = v1.tasks.map(t => ({ id: t.id, title: t.title, status: t.status, version: t.version, paused: t.paused, deadlineOn: t.deadlineOn ?? null, attentionOn: t.attentionOn ?? null, createdOn: t.createdOn, sourcePageId: t.sourcePageId, ...(t.doneOn !== undefined ? { doneOn: t.doneOn } : {}) }))
  // A plan on a day whose page doesn't hold its row (or doesn't exist): the row goes on, the page is made if needed.
  for (const x of v1.placements) {
    if (x.state !== 'included') continue
    const t = taskById.get(x.taskId)
    if (!t || t.status !== 'open' || t.plannedOn !== x.date) continue
    let page = pages.find(p => p.type === 'daily' && p.date === x.date)
    if (!page) { page = { id: `day:${x.date}`, type: 'daily', date: x.date, title: x.date, document: JSON.stringify(templateDocument(`day:${x.date}`, x.date)) }; pages.push(page) }
    const doc = JSON.parse(page.document) as EditorNode[]
    if (flatNodes(doc).some(n => rowTaskId(n) === t.id && rowRole(n) === 'plan')) continue
    const existing = flatNodes(doc).find(n => rowTaskId(n) === t.id)
    if (existing) { existing.props = { ...existing.props, role: 'plan', planDate: x.date }; page.document = JSON.stringify(doc); continue }
    doc.splice(rowInsertIndex(doc, new Set(tasks.map(k => k.id))), 0, { id: `${page.id}:plan:${t.id}`, type: 'task', props: { taskId: t.id, role: 'plan', planDate: x.date }, content: [textRun(t.title)], children: [] })
    page.document = JSON.stringify(doc)
  }
  // Stored events with no line: a line with a chip under their day's Events heading.
  const held = new Set(v1.pages.flatMap(p => p.sections.flatMap(s => s.blocks.filter(b => b.kind === 'event' && b.eventId).map(b => b.eventId!))))
  for (const e of v1.events) {
    if (e.cancelled || held.has(e.id)) continue
    let page = pages.find(p => p.type === 'daily' && p.date === e.date)
    if (!page) { page = { id: `day:${e.date}`, type: 'daily', date: e.date, title: e.date, document: JSON.stringify(templateDocument(`day:${e.date}`, e.date)) }; pages.push(page) }
    const doc = JSON.parse(page.document) as EditorNode[]
    const events = doc.findIndex(n => n.type === 'heading' && inlineText(n.content).trim().toLowerCase() === 'events')
    const line: EditorNode = { id: `${page.id}:event:${e.id}`, type: 'bulletListItem', props: {}, content: [textRun(`${e.title} `), chip(e)], children: [] }
    doc.splice(events >= 0 ? events + 1 : doc.length, 0, line)
    page.document = JSON.stringify(doc)
  }
  // Words that lived outside the document: a saved evening reflection, and captured text the model never filed. They
  // go on their page as lines, at the end, so nothing he typed is lost.
  for (const old of v1.pages) {
    const page = pages.find(p => p.id === old.id)!
    const reflection = old.reviewText?.trim()
    const unfiled = (v1.captures ?? []).filter(c => c.pageId === old.id && ['organizing', 'needs_confirmation', 'failed'].includes(c.status) && c.text.trim())
    if (!reflection && !unfiled.length) continue
    const doc = JSON.parse(page.document) as EditorNode[]
    if (reflection) doc.push(headingNode('Evening review', `${page.id}:review-h`), { id: `${page.id}:review`, type: 'paragraph', props: {}, content: [textRun(reflection)], children: [] })
    if (unfiled.length) doc.push(headingNode('Captured', `${page.id}:captured-h`), ...unfiled.map(c => ({ id: `${page.id}:capture:${c.id}`, type: 'bulletListItem', props: {}, content: [textRun(c.text.trim())], children: [] })))
    page.document = JSON.stringify(doc)
  }
  // Never-saved day pages from today on get the template's empty rows, as the old editor added them on opening.
  for (const page of pages) {
    const old = v1.pages.find(p => p.id === page.id)
    if (!old || old.type !== 'daily' || old.editorSections || !old.date || old.date < today) continue
    const doc = JSON.parse(page.document) as EditorNode[]
    const out: EditorNode[] = []
    for (const s of old.sections) {
      const at = doc.findIndex(n => n.id === s.id)
      if (at < 0) continue
      const range = sectionEnd(doc, at)
      const row = s.kind === 'top3' || s.kind === 'other' ? emptyTaskRow(old.date, `${s.id}:template:0`) : emptyLine('bulletListItem', `${s.id}:template:0`)
      out.push({ ...row, atIndex: range } as EditorNode & { atIndex: number })
    }
    for (const { atIndex, ...row } of (out as (EditorNode & { atIndex: number })[]).sort((a, b) => b.atIndex - a.atIndex)) doc.splice(atIndex, 0, row)
    page.document = JSON.stringify(doc)
  }
  return { schemaVersion: 2, revision: v1.revision, timezone: v1.timezone, pages, tasks, deletedTasks: [], receipts: v1.receipts }
}

const chip = (e: V1Event) => ({ type: 'dateMention', props: { eventId: e.id, date: e.date, time: e.time ?? '' } })
/** The index after a heading's section (next heading of level ≤ 2, or the end). */
function sectionEnd(doc: EditorNode[], heading: number): number {
  let end = heading + 1
  while (end < doc.length && doc[end]!.type !== 'heading') end++
  return end
}

/**
 * The old editor seed: the page's editor JSON when it matched its sections; otherwise rebuilt from the sections with
 * the old JSON's nodes where they exist. Then every stored fact the new model keeps in the document is written in:
 * events as chips, saved links as links, reference times on cards and `[[` links.
 */
function v1Document(p: V1Page, ws: V1Workspace): EditorNode[] {
  const previous: EditorNode[] = p.editorJSON ? safeParse(p.editorJSON) : []
  const byId = new Map<string, EditorNode>()
  const remember = (node: EditorNode) => { byId.set(node.id, node); node.children?.forEach(remember) }
  previous.forEach(remember)
  let nodes: EditorNode[]
  if (p.editorJSON && p.editorSections === JSON.stringify(p.sections)) nodes = structuredClone(previous)
  else {
    const emitted = new Set<string>()
    const mark = (node: EditorNode) => { emitted.add(node.id); node.children?.forEach(mark) }
    nodes = []
    for (const s of p.sections) {
      if (!s.id.startsWith('intro:')) {
        const node = byId.get(s.id) ? structuredClone(byId.get(s.id)!) : headingNode(s.title, s.id)
        if (!byId.get(s.id)) node.content = [textRun(s.title)]
        nodes.push(node); mark(node)
      }
      for (const b of s.blocks) {
        if (emitted.has(b.id)) continue
        const prior = byId.get(b.id)
        const node: EditorNode = prior ? structuredClone(prior)
          : b.taskId ? { id: b.id, type: 'task', props: { taskId: b.taskId, role: b.planRole ?? 'reference', planDate: '' }, content: [textRun(ws.tasks.find(t => t.id === b.taskId)?.title ?? b.text)], children: [] }
          : b.targetPageId ? { id: b.id, type: 'pageLink', props: { pageId: b.targetPageId }, children: [] }
          : b.materialId ? { id: b.id, type: 'paragraph', props: {}, content: [{ type: 'link', href: ws.materials.find(m => m.id === b.materialId)?.url ?? '#', content: [textRun(b.text)] }], children: [] }
          : { id: b.id, type: 'paragraph', props: {}, content: b.text ? [textRun(b.text)] : [], children: [] }
        nodes.push(node); mark(node)
      }
    }
  }
  const blocks = new Map(p.sections.flatMap(s => s.blocks.map(b => [b.id, b])))
  const refs = new Map<string, V1Ref>()
  for (const s of p.sections) { for (const r of s.refs ?? []) refs.set(r.refId, r); for (const b of s.blocks) for (const r of b.refs ?? []) refs.set(r.refId, r) }
  for (const n of flatNodes(nodes)) {
    const b = blocks.get(n.id)
    if (b?.kind === 'event' && b.eventId) {
      const e = ws.events.find(x => x.id === b.eventId)
      if (e) { n.type = 'bulletListItem'; n.props = {}; n.content = [textRun(`${e.title} `), chip(e)] }
    }
    if (n.type === 'pageLink' && b?.at !== undefined && n.props?.at === undefined) n.props = { ...n.props, at: b.at }
    if (Array.isArray(n.content)) for (const c of n.content as { type?: string; props?: Record<string, unknown> }[]) {
      if (c?.type !== 'pageRef' || !c.props) continue
      const r = refs.get(String(c.props.refId ?? ''))
      if (r && c.props.at === undefined) c.props.at = r.at
    }
    if (isTaskRow(n) && !n.props) n.props = {}
  }
  return nodes
}
function safeParse(text: string): EditorNode[] {
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : [] } catch { return [] }
}
