// Smart notes: a workspace-level record holds the prompt, the range and the model's result; a page holds only a `smartNote` block with `props.noteId`.
import { flatNodes, pageNodes } from './editor-document.ts'
import { isTrashed } from './page-tree.ts'
import type { LocalDate, Page, Workspace } from './types.ts'

export const smartNoteBlockType = 'smartNote'
export const smartLimits = { name: 120, prompt: 2000, pages: 50, tag: 100, notes: 100, blocks: 60, text: 600, sourcesPerBlock: 8, inputChars: 60_000, pageChars: 6_000, lineChars: 400 } as const
export type SmartWhere = { kind: 'workspace' } | { kind: 'pages'; pageIds: string[] } | { kind: 'tag'; tag: string } | { kind: 'days' }
/** 0: all time. */
export type SmartWindow = 0 | 7 | 30 | 90
export interface SmartRange { where: SmartWhere; days: SmartWindow }
export interface SmartSource { pageId: string; blockId: string }
export interface SmartBlock { kind: 'heading' | 'paragraph' | 'bullet'; text: string; sources: SmartSource[] }
export interface SmartResult { blocks: SmartBlock[]; at: string; inputKey: string; pagesRead: number; pagesLeftOut: number; from: LocalDate | null; to: LocalDate | null }
export interface SmartNote { id: string; name: string; prompt: string; range: SmartRange; refresh: 'manual' | 'daily' | 'hourly'; result: SmartResult }

export const smartNoteOf = (ws: Pick<Workspace, 'smartNotes'>, id: string): SmartNote | undefined => ws.smartNotes?.find(n => n.id === id)

/** Blocks showing the note on live pages (not in Trash). */
export function smartPlaces(ws: Pick<Workspace, 'pages'>, noteId: string): { page: Page; blockId: string }[] {
  return ws.pages.filter(p => !isTrashed(p)).flatMap(page => flatNodes(pageNodes(page)).filter(n => n.type === smartNoteBlockType && n.props?.noteId === noteId).map(n => ({ page, blockId: n.id })))
}

/** For the picker: notes with at least one place, by name. */
export function placedSmartNotes(ws: Pick<Workspace, 'pages' | 'smartNotes'>): { note: SmartNote; places: number }[] {
  return (ws.smartNotes ?? []).map(note => ({ note, places: smartPlaces(ws, note.id).length })).filter(p => p.places > 0).sort((a, b) => a.note.name.localeCompare(b.note.name))
}
