// Synced blocks (docs/design/synced-blocks.md, docs/plan/b21-sizing.md): one piece of content shown in several places. The
// lines live once, in a record. A page's stored row holds only its `syncedBlock` block; in memory each place is expanded, so
// everything that reads a page's lines reads them as usual, and an edit writes one row however many places there are.
// With no record in a workspace none of this does anything.
import { pageNodes, type EditorNode } from './editor-document.ts'
import type { Page, Workspace } from './types.ts'

export const syncedBlockType = 'syncedBlock'
export interface SyncedRecord {
  id: string
  /** The lines (`EditorNode[]`, JSON text like a page's `document`), each to-do row as a reference: its role is per place. */
  lines: string
  /** Goes up with each edit: a place on an older one hasn't seen it. */
  rev: number
  /** The block it was made as (design §2). */
  original: string
}
type Roles = Record<string, { role: string; planDate: string }>

const mentionsBlock = (document: string) => document.includes(`"${syncedBlockType}"`)
const isBlock = (n: EditorNode) => n.type === syncedBlockType
const isRow = (n: EditorNode) => n.type === 'task'
const walk = (nodes: EditorNode[], visit: (n: EditorNode) => void) => { for (const n of nodes) { visit(n); if (n.children?.length) walk(n.children, visit) } }
const separator = ':'
/** A line's id in a place: its own at the original, so links to the lines he synced still work; elsewhere unique to that place. */
const placeId = (lineId: string, blockId: string, original: boolean) => (original ? lineId : `${lineId}${separator}${blockId}`)
const lineIdOf = (id: string, blockId: string) => (id.endsWith(`${separator}${blockId}`) ? id.slice(0, -(blockId.length + 1)) : id)

function placed(block: EditorNode, record: SyncedRecord, roles: Roles, lines = pageNodes({ document: record.lines })): EditorNode[] {
  const original = record.original === block.id
  return lines.map(line => {
    const role = isRow(line) ? roles[line.id] : undefined
    return {
      ...line, id: placeId(line.id, block.id, original),
      ...(role ? { props: { ...line.props, role: role.role, planDate: role.planDate } } : {}),
      children: placed(block, record, roles, line.children ?? []),
    }
  })
}
/** A place's lines as the record holds them, and what's its own: its rows' roles. */
function unplaced(block: EditorNode, roles: Roles = {}): EditorNode[] {
  return (block.children ?? []).map(function line(n: EditorNode): EditorNode {
    const id = lineIdOf(n.id, block.id)
    if (isRow(n) && n.props?.role && n.props.role !== 'reference') roles[id] = { role: String(n.props.role), planDate: String(n.props.planDate ?? '') }
    return { ...n, id, ...(isRow(n) ? { props: { ...n.props, role: 'reference', planDate: '' } } : {}), children: (n.children ?? []).map(line) }
  })
}
const rolesOf = (block: EditorNode): Roles => { try { return JSON.parse(String(block.props?.roles || '{}')) as Roles } catch { return {} } }

/** The document with each block's lines in it, as they are now. */
export function expandedDocument(document: string, records: readonly SyncedRecord[]): string {
  if (!mentionsBlock(document)) return document
  const nodes = JSON.parse(document) as EditorNode[]
  walk(nodes, n => {
    if (!isBlock(n)) return
    const record = records.find(r => r.id === n.props?.syncId)
    if (!record) return
    const roles = rolesOf(n)
    if (n.children?.length) unplaced(n, roles)
    n.children = placed(n, record, roles)
    n.props = { ...n.props, rev: record.rev, roles: '' }
  })
  return JSON.stringify(nodes)
}

/** What a page's row stores, and what its content is compared by: each block without its lines, with its own rows' roles. */
export function storedDocument(document: string): string {
  if (!mentionsBlock(document)) return document
  const nodes = JSON.parse(document) as EditorNode[]
  const strip = (list: EditorNode[]) => list.map((n): EditorNode => {
    if (!isBlock(n)) return n.children?.length ? { ...n, children: strip(n.children) } : n
    const roles: Roles = {}
    if (n.children?.length) unplaced(n, roles)
    const { rev: _rev, ...props } = n.props ?? {}
    return { ...n, props: { ...props, roles: n.children?.length ? (Object.keys(roles).length ? JSON.stringify(roles) : '') : props.roles ?? '' }, children: [] }
  })
  return JSON.stringify(strip(nodes))
}

const hasRecords = (ws: Pick<Workspace, 'synced'>) => Boolean(ws.synced?.length)
/** Each page with its blocks' lines. The same pages when there's nothing to do. */
export function expandedWorkspace(ws: Workspace): Workspace {
  if (!hasRecords(ws)) return ws
  return { ...ws, pages: ws.pages.map(p => { const document = expandedDocument(p.document, ws.synced!); return document === p.document ? p : { ...p, document } }) }
}
/** The workspace as it travels to the browser, which expands it again. */
export function strippedWorkspace(ws: Workspace): Workspace {
  if (!hasRecords(ws)) return ws
  return { ...ws, pages: ws.pages.map(p => { const document = storedDocument(p.document); return document === p.document ? p : { ...p, document } }) }
}

/**
 * A save's blocks, before it's written. A new `syncId` makes a record from its lines (this place is the original); a block new
 * to the page, with a record already, arrives as a copy and brings nothing of its own. A place on an older revision hasn't
 * seen the latest: it takes the record, unless he edited it, which is refused so nothing he typed goes (design §5).
 */
export function acceptSavedBlocks(state: Workspace, page: Page, nodes: EditorNode[], refuse: (message: string) => never): void {
  if (!nodes.length || !JSON.stringify(nodes).includes(`"${syncedBlockType}"`)) return
  const here = new Set<string>()
  walk(pageNodes(page), n => { if (isBlock(n)) here.add(n.id) })
  walk(nodes, n => {
    if (!isBlock(n)) return
    const syncId = n.props?.syncId
    if (typeof syncId !== 'string' || !syncId) refuse('Invalid editor document')
    const record = state.synced?.find(r => r.id === syncId)
    const edited = n.props?.edited === true
    if (n.props) delete n.props.edited
    if (!record) { (state.synced ??= []).push({ id: syncId as string, lines: JSON.stringify(unplaced(n)), rev: 1, original: n.id }); return }
    if (!here.has(n.id)) { n.children = []; return }
    if (Number(n.props?.rev) < record.rev) {
      if (edited) refuse('Synced block changed elsewhere. Your editor draft is kept.')
      n.children = []
    }
  })
}

/**
 * After a command: a place whose lines differ from its record is where they changed, and the record takes them. Then every
 * place is written again from the record, its own roles kept, so one command never leaves two places apart.
 */
export function settleSynced(state: Workspace): void {
  if (!hasRecords(state)) return
  // Measured against the record as it was, so the places that haven't changed don't change it back.
  const was = new Map(state.synced!.map(r => [r.id, r.lines]))
  for (const page of state.pages) {
    if (!mentionsBlock(page.document)) continue
    walk(pageNodes(page), n => {
      if (!isBlock(n) || !n.children?.length) return
      const record = state.synced!.find(r => r.id === n.props?.syncId)
      if (!record) return
      const lines = JSON.stringify(unplaced(n))
      if (lines !== was.get(record.id)) record.lines = lines
    })
  }
  for (const record of state.synced!) if (record.lines !== was.get(record.id)) record.rev++
  for (const page of state.pages) {
    if (!mentionsBlock(page.document)) continue
    // A place's roles come from its rows when it has them, or its stored block when it was written without.
    const nodes = JSON.parse(storedDocument(page.document)) as EditorNode[]
    walk(nodes, n => {
      if (!isBlock(n)) return
      const record = state.synced!.find(r => r.id === n.props?.syncId)
      if (record) { n.children = placed(n, record, rolesOf(n)); n.props = { ...n.props, rev: record.rev, roles: '' } }
    })
    page.document = JSON.stringify(nodes)
  }
}
