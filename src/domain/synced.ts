// Synced blocks (docs/design/synced-blocks.md, docs/plan/b21-sizing.md): one piece of content shown in several places. The
// lines live once, in a record. A page's stored row holds only its `syncedBlock` block; in memory each place is expanded, so
// everything that reads a page's lines reads them as usual, and an edit writes one row however many places there are.
// With no record in a workspace none of this does anything.
import { pageContentKey, pageNodes, type EditorNode } from './editor-document.ts'
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
/** A new line's id, the same in the browser's preview and on the server. Only the hash of the key: it has no separator in it. */
function derivedId(text: string): string {
  const hash = pageContentKey({ document: text }).split(separator).at(-1)!.padEnd(32, '0')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
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
/** The lines as a place holds them, as one short key: what it had when it last read the record, so a later save can tell if he changed them. */
export const blockLinesKey = (block: EditorNode): string => linesKey(unplaced(block))
const recordKey = (record: SyncedRecord): string => linesKey(pageNodes({ document: record.lines }))
/** What the lines say, whichever way they were written: the editor fills in default props the record may not hold yet. */
const defaultProps: Record<string, unknown> = { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }
const canonical = (nodes: EditorNode[]): unknown[] => nodes.map(n => ({
  id: n.id, type: n.type, content: n.content ?? [],
  props: Object.fromEntries(Object.entries(n.props ?? {}).filter(([k, v]) => defaultProps[k] !== v).sort(([a], [b]) => (a < b ? -1 : 1))),
  children: canonical(n.children ?? []),
}))
const linesKey = (lines: EditorNode[]): string => pageContentKey({ document: JSON.stringify(canonical(lines)) })
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
    n.props = { ...n.props, rev: record.rev, key: recordKey(record), roles: '' }
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
    const { rev: _rev, key: _key, ...props } = n.props ?? {}
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
 * seen the latest. If its lines are what it last read, it just takes the latest. If he changed them, both can't be right, so
 * the block takes the latest and his version goes right below it as ordinary lines, so nothing he typed goes (states §5).
 * Returns the blocks that happened to.
 */
export function acceptSavedBlocks(state: Workspace, page: Page, nodes: EditorNode[], refuse: (message: string) => never): string[] {
  if (!nodes.length || !JSON.stringify(nodes).includes(`"${syncedBlockType}"`)) return []
  const here = new Set<string>(), conflicts: string[] = []
  walk(pageNodes(page), n => { if (isBlock(n)) here.add(n.id) })
  const visit = (list: EditorNode[]) => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i]!
      if (!isBlock(n)) { if (n.children?.length) visit(n.children); continue }
      const syncId = n.props?.syncId
      if (typeof syncId !== 'string' || !syncId) refuse('Invalid editor document')
      const record = state.synced?.find(r => r.id === syncId)
      // Its record isn't here and it brings no lines: nothing to make, and the block stays as it is.
      if (!record && !n.children?.length) continue
      if (!record) { (state.synced ??= []).push({ id: syncId as string, lines: JSON.stringify(unplaced(n)), rev: 1, original: n.id }); continue }
      if (!here.has(n.id)) { n.children = []; continue }
      if (Number(n.props?.rev) >= record.rev) continue
      const changed = blockLinesKey(n) !== n.props?.key && Boolean(n.children?.length)
      if (changed) {
        const mine = (n.children ?? []).map(function fresh(line: EditorNode): EditorNode {
          const { id, ...rest } = line
          return { ...rest, id: derivedId(`${id}|${n.id}|${record.rev}`), children: (line.children ?? []).map(fresh) }
        })
        list.splice(i + 1, 0, ...mine)
        i += mine.length
        conflicts.push(n.id)
      }
      n.children = []
    }
  }
  visit(nodes)
  return conflicts
}

/**
 * After a command: a place whose lines differ from its record is where they changed, and the record takes them. Then every
 * place is written again from the record, its own roles kept, so one command never leaves two places apart.
 */
export function settleSynced(state: Workspace): void {
  if (!hasRecords(state)) return
  // Measured against the record as it was, so the places that haven't changed don't change it back.
  const was = new Map(state.synced!.map(r => [r.id, recordKey(r)]))
  for (const page of state.pages) {
    if (!mentionsBlock(page.document)) continue
    walk(pageNodes(page), n => {
      if (!isBlock(n) || !n.children?.length) return
      const record = state.synced!.find(r => r.id === n.props?.syncId)
      if (!record) return
      const lines = unplaced(n)
      if (linesKey(lines) !== was.get(record.id)) record.lines = JSON.stringify(lines)
    })
  }
  for (const record of state.synced!) if (recordKey(record) !== was.get(record.id)) record.rev++
  for (const page of state.pages) {
    if (!mentionsBlock(page.document)) continue
    // A place's roles come from its rows when it has them, or its stored block when it was written without.
    const nodes = JSON.parse(storedDocument(page.document)) as EditorNode[]
    walk(nodes, n => {
      if (!isBlock(n)) return
      const record = state.synced!.find(r => r.id === n.props?.syncId)
      if (record) { n.children = placed(n, record, rolesOf(n)); n.props = { ...n.props, rev: record.rev, key: recordKey(record), roles: '' } }
    })
    page.document = JSON.stringify(nodes)
  }
}

/**
 * What a page's editor does when the page has its blocks' latest (`saved`): for each block, the facts to take and, when its lines
 * should follow, the lines. `own`: this editor's save, so it starts from there, whatever he's typed since. Otherwise a block he
 * has changed stays as it is, and the next save sorts it out (above).
 */
export interface BlockUpdate { id: string; rev: number; key: string; lines: EditorNode[] | null; rename: Record<string, string> }
export function blockUpdates(editorNodes: EditorNode[], saved: string, own: boolean): BlockUpdate[] {
  if (!mentionsBlock(saved)) return []
  const held = new Map<string, EditorNode>()
  walk(editorNodes, n => { if (isBlock(n)) held.set(n.id, n) })
  const out: BlockUpdate[] = []
  walk(JSON.parse(saved) as EditorNode[], s => {
    const e = isBlock(s) ? held.get(s.id) : undefined
    if (!e) return
    const rev = Number(s.props?.rev), key = String(s.props?.key ?? ''), mine = blockLinesKey(e)
    if (mine === key) {
      // The same lines: only what's new here takes this place's ids.
      const rename: Record<string, string> = {}, ids = new Set<string>()
      walk(s.children ?? [], n => ids.add(n.id))
      walk(e.children ?? [], n => { if (!ids.has(n.id) && ids.has(`${n.id}${separator}${e.id}`)) rename[n.id] = `${n.id}${separator}${e.id}` })
      if (rev !== Number(e.props?.rev) || e.props?.key !== key || Object.keys(rename).length) out.push({ id: e.id, rev, key, lines: null, rename })
    // His own save, and he's typed since: it starts from what was saved, so what he's typed still reads as changed, and saves.
    } else if (own) out.push({ id: e.id, rev, key, lines: null, rename: {} })
    else if (mine === e.props?.key) out.push({ id: e.id, rev, key, lines: s.children ?? [], rename: {} })
  })
  return out
}

/** A document as what he wrote, to tell if he's typed more: without what a save sets on a block, or this place's id on a new line. */
export function writtenDocument(document: string): string {
  if (!mentionsBlock(document)) return document
  const nodes = JSON.parse(document) as EditorNode[]
  walk(nodes, n => {
    if (!isBlock(n)) return
    const { rev: _rev, key: _key, ...props } = n.props ?? {}
    n.props = props
    n.children = unplaced(n)
  })
  return JSON.stringify(nodes)
}
