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
  const here = new Set<string>(), conflicts: string[] = [], editedHere = new Map<string, string>()
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
      let changed = false
      if (Number(n.props?.rev) >= record.rev) {
        // Every line deleted: one empty line stays, and the block (states §5).
        if (!n.children?.length) n.children = [{ id: derivedId(`${n.id}|${record.rev}`), type: 'paragraph', props: {}, content: [], children: [] }]
        // Two places on this page changed differently in one save: the first is the edit, and the other's words go below it, not away.
        const key = blockLinesKey(n), first = editedHere.get(record.id)
        if (key === recordKey(record)) continue
        if (first === undefined || first === key) { editedHere.set(record.id, key); continue }
        changed = true
      } else changed = blockLinesKey(n) !== n.props?.key && Boolean(n.children?.length)
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
/**
 * A database's home has one place, on the original. When its block has gone from every line and it's still not on the page that holds
 * the database, a save elsewhere removed it or the original went: the database stays, as a full page there, and any views keep showing it. Deleting never takes more than it says (R2-3, design §6).
 */
function detachLostHomes(state: Workspace, lost: readonly EditorNode[]): void {
  for (const line of lost) {
    const db = state.pages.find(p => p.id === line.props?.pageId && !p.trashedAt && p.database?.homeBlockId === line.id)
    if (!db) continue
    const parent = state.pages.find(p => p.id === db.parentId)
    let there = false
    if (parent) walk(pageNodes(parent), n => { if (n.id === line.id) there = true })
    if (!there) db.database!.homeBlockId = null
  }
}
const databasesIn = (lines: readonly EditorNode[]): EditorNode[] => { const out: EditorNode[] = []; walk(lines as EditorNode[], n => { if (n.type === 'database') out.push(n) }); return out }
export function settleSynced(state: Workspace): { linesRemovedFrom?: number } {
  // A block only comes from a template or a duplicate where a record exists already, so with none this costs nothing (B21-14).
  if (!hasRecords(state)) return {}
  let linesRemovedFrom: number | undefined
  const lostHomes: EditorNode[] = []
  // Measured against the record as it was, so the places that haven't changed don't change it back.
  const was = new Map(state.synced!.map(r => [r.id, recordKey(r)]))
  for (const page of state.pages) {
    if (!mentionsBlock(page.document)) continue
    walk(pageNodes(page), n => {
      if (!isBlock(n) || !n.children?.length) return
      const record = state.synced!.find(r => r.id === n.props?.syncId)
      // Made outside a save, on a new page from a template: its own, starting here.
      if (!record) { state.synced!.push({ id: String(n.props?.syncId), lines: JSON.stringify(unplaced(n)), rev: 1, original: n.id }); return }
      const lines = unplaced(n)
      if (linesKey(lines) !== was.get(record.id)) {
        // Fewer lines than it had, on a block shown elsewhere too.
        const count = (list: EditorNode[]): number => list.reduce((sum, l) => sum + 1 + count(l.children ?? []), 0)
        if (count(lines) < count(pageNodes({ document: record.lines }))) { const pages = new Set(syncedPlaces(state, record.id).map(p => p.page.id)).size; if (pages > 1) linesRemovedFrom = pages }
        const still = new Set(databasesIn(lines).map(l => l.id))
        lostHomes.push(...databasesIn(pageNodes({ document: record.lines })).filter(l => !still.has(l.id)))
        record.lines = JSON.stringify(lines)
      }
    })
  }
  for (const record of state.synced!) if (was.has(record.id) && recordKey(record) !== was.get(record.id)) record.rev++
  dropUnheldRecords(state)
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
  detachLostHomes(state, lostHomes)
  return linesRemovedFrom ? { linesRemovedFrom } : {}
}

/** A place's lines as another place on the page shows them: its ids, its rows' roles. For two copies on one page, as he types (B21-3). */
export function mirroredLines(source: EditorNode, target: EditorNode, record: SyncedRecord | undefined): EditorNode[] {
  const roles: Roles = {}
  unplaced(target, roles)
  const lines = unplaced(source)
  return placed(target, record ?? { id: '', lines: '[]', rev: 0, original: '' }, roles, lines)
}
/**
 * What a place's own new lines become before they're mirrored. Until a save names them they carry the id the editor gave them, and
 * the original, which keeps plain ids, is about to hold that same id: one page can't have it twice.
 */
export function ownLineIds(source: EditorNode, record: SyncedRecord | undefined): Record<string, string> {
  const rename: Record<string, string> = {}
  if (!record || record.original === source.id) return rename
  walk(source.children ?? [], n => { if (!n.id.endsWith(`${separator}${source.id}`)) rename[n.id] = `${n.id}${separator}${source.id}` })
  return rename
}
/** Where a page or database made in these lines lives: they have one home, the original's page, whichever place he's typing in (design §6). */
export function homePageOfRecord(ws: Pick<Workspace, 'pages' | 'synced'>, syncId: string): Page | undefined {
  const original = ws.synced?.find(r => r.id === syncId)?.original
  const page = syncedPlaces(ws, syncId).find(p => p.block.id === original)?.page
  return page && !page.trashedAt ? page : undefined
}
/** Every place a record is shown, Trash included, with the page it's on, in the workspace's order. */
export function syncedPlaces(ws: Pick<Workspace, 'pages'>, syncId: string): { page: Page; block: EditorNode }[] {
  const out: { page: Page; block: EditorNode }[] = []
  for (const page of ws.pages) {
    if (!mentionsBlock(page.document)) continue
    walk(pageNodes(page), n => { if (isBlock(n) && n.props?.syncId === syncId) out.push({ page, block: n }) })
  }
  return out
}
export const isSyncedBlock = isBlock
/** A line's own id, wherever it's shown: in a synced block, the id it has in the record. */
export function sharedLineId(nodes: readonly EditorNode[], id: string): string {
  let found = id
  const inside = (list: readonly EditorNode[], block: EditorNode | null) => { for (const n of list) { if (n.id === id && block) found = lineIdOf(id, block.id); inside(n.children ?? [], isBlock(n) ? n : block) } }
  inside(nodes, null)
  return found
}
/** The ids a shared line has on this page: one for each place, or its own if it's an ordinary line here. */
export function lineIdsOnPage(page: Pick<Page, 'document'>, lineId: string): string[] {
  const out: string[] = []
  const inside = (list: readonly EditorNode[], block: EditorNode | null) => { for (const n of list) { if (n.id === lineId || (block && lineIdOf(n.id, block.id) === lineId)) out.push(n.id); inside(n.children ?? [], isBlock(n) ? n : block) } }
  inside(pageNodes(page), null)
  return out
}
/** The record a line's in, if it's shared. */
export function recordOfLine(ws: Pick<Workspace, 'synced'>, lineId: string): SyncedRecord | undefined {
  if (!ws.synced?.length) return undefined
  const has = (list: readonly EditorNode[]): boolean => list.some(n => n.id === lineId || has(n.children ?? []))
  return ws.synced.find(r => has(pageNodes({ document: r.lines })))
}
/** The block a record was made as: on a template or a duplicated row it makes its own block; any other place stays connected (design §7). */
export const isOriginalBlock = (ws: Pick<Workspace, 'synced'>, n: EditorNode): boolean => ws.synced?.find(r => r.id === n.props?.syncId)?.original === n.id
/**
 * Where a block counts when it counts once (states §7): Search under the original, or the oldest live place if that's in Trash;
 * Tags under its earliest day, or that same place if no day page shows it. Templates and hidden pages don't count.
 */
export function syncedHome(ws: Pick<Workspace, 'pages' | 'synced'>, syncId: string, by: 'original' | 'day', counts: (p: Page) => boolean): string | null {
  const places = syncedPlaces(ws, syncId).filter(p => counts(p.page))
  if (!places.length) return null
  if (by === 'day') { const days = places.filter(p => p.page.date).sort((a, b) => a.page.date!.localeCompare(b.page.date!)); if (days.length) return days[0]!.block.id }
  const original = ws.synced?.find(r => r.id === syncId)?.original
  return (places.find(p => p.block.id === original) ?? places[0]!).block.id
}
/** Once no place is left anywhere, the record goes: a deleted note isn't kept behind his back (Undo's copy still has it). */
function dropUnheldRecords(state: Workspace): void {
  if (!state.synced?.length) return
  const held = new Set<string>()
  for (const page of state.pages) {
    if (!mentionsBlock(page.document)) continue
    walk(pageNodes(page), n => { if (isBlock(n)) held.add(String(n.props?.syncId)) })
  }
  state.synced = state.synced.filter(r => held.has(r.id))
  if (!state.synced.length) delete state.synced
}
/** A block turned into ordinary lines, where it sits, under the ids they have there, its rows keeping their roles. */
function withoutBlock(nodes: EditorNode[], matches: (n: EditorNode) => boolean, keepLines: boolean): EditorNode[] {
  return nodes.flatMap(n => {
    if (isBlock(n) && matches(n)) return keepLines ? n.children ?? [] : []
    return n.children?.length ? [{ ...n, children: withoutBlock(n.children, matches, keepLines) }] : [n]
  })
}
function rewrite(page: Page, matches: (n: EditorNode) => boolean, keepLines: boolean): void {
  page.document = JSON.stringify(withoutBlock(pageNodes(page), matches, keepLines))
}
/** "Unsync here" or, on the original, "Unsync all": those places become ordinary lines. No task changes: rows stay rows of the same task. */
export function unsyncBlock(state: Workspace, syncId: string, blockId: string, all: boolean): number {
  const places = syncedPlaces(state, syncId)
  const here = places.find(p => p.block.id === blockId)
  if (!here) return 0
  const pages = new Set((all ? places : [here]).map(p => p.page))
  for (const page of pages) rewrite(page, n => n.props?.syncId === syncId && (all || n.id === blockId), true)
  return places.length
}
/**
 * Deleting a place. A copy just goes. The original ends the syncing: every other place keeps its lines as ordinary lines, as
 * the only choice that loses nothing (design §4), at any count. How many places it had.
 */
export function deleteBlockPlace(state: Workspace, syncId: string, blockId: string): { places: number; wasOriginal: boolean } {
  const places = syncedPlaces(state, syncId), record = state.synced?.find(r => r.id === syncId)
  const here = places.find(p => p.block.id === blockId)
  if (!here || !record) return { places: 0, wasOriginal: false }
  const wasOriginal = record.original === blockId
  const homes = wasOriginal ? databasesIn(pageNodes({ document: record.lines })) : []
  rewrite(here.page, n => n.id === blockId, false)
  if (wasOriginal) for (const { page } of places) if (mentionsBlock(page.document)) rewrite(page, n => n.props?.syncId === syncId, true)
  detachLostHomes(state, homes)
  return { places: places.length, wasOriginal }
}

/**
 * What a page's editor does when the page has its blocks' latest (`saved`): for each block, the facts to take and, when its lines
 * should follow, the lines. `own`: this editor's save, so it starts from there, whatever he's typed since. Otherwise a block he
 * has changed stays as it is, and the next save sorts it out (above).
 */
export interface BlockUpdate { id: string; rev: number; key: string; lines: EditorNode[] | null; rename: Record<string, string> }
export function blockUpdates(editorNodes: EditorNode[], saved: string, own: boolean, sent?: string): BlockUpdate[] {
  if (!mentionsBlock(saved)) return []
  const held = new Map<string, EditorNode>(), sentLines = new Map<string, string>()
  walk(editorNodes, n => { if (isBlock(n)) held.set(n.id, n) })
  if (sent) walk(JSON.parse(sent) as EditorNode[], n => { if (isBlock(n)) sentLines.set(n.id, blockLinesKey(n)) })
  const out: BlockUpdate[] = []
  walk(JSON.parse(saved) as EditorNode[], s => {
    const e = isBlock(s) ? held.get(s.id) : undefined
    if (!e) return
    const rev = Number(s.props?.rev), key = String(s.props?.key ?? ''), mine = blockLinesKey(e)
    // His own save, and these lines have changed since it went: an Undo back to where they started looks untouched, but it's his latest,
    // so it starts from what was saved and goes in the next save (Ratchet 0074b95c).
    if (own && mine !== key && sentLines.has(e.id) && sentLines.get(e.id) !== mine) { out.push({ id: e.id, rev, key, lines: null, rename: {} }); return }
    // A copy just pasted hasn't read the record yet, and takes its lines. Its `key` says what it was pasted with, so words he's typed
    // since stay his; a block he's just made has no key, and goes on below (Lead's review of #96).
    if (!Number(e.props?.rev) && mine === e.props?.key) { out.push({ id: e.id, rev, key, lines: s.children ?? [], rename: {} }); return }
    if (mine === key) {
      // The same lines: only what's new here takes this place's ids.
      const rename: Record<string, string> = {}, ids = new Set<string>()
      walk(s.children ?? [], n => ids.add(n.id))
      walk(e.children ?? [], n => { if (!ids.has(n.id) && ids.has(`${n.id}${separator}${e.id}`)) rename[n.id] = `${n.id}${separator}${e.id}` })
      if (rev !== Number(e.props?.rev) || e.props?.key !== key || Object.keys(rename).length) out.push({ id: e.id, rev, key, lines: null, rename })
    // Unchanged since it last read: it follows, whoever saved. That has to come first: another place on this page keeps its old lines
    // otherwise, and the next save sends them back as an edit (Lead's review of #96).
    } else if (mine === e.props?.key) out.push({ id: e.id, rev, key, lines: s.children ?? [], rename: {} })
    // His own save, and he's typed since: it starts from what was saved, so what he's typed still reads as changed, and saves.
    else if (own) out.push({ id: e.id, rev, key, lines: null, rename: {} })
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
