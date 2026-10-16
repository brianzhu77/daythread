export type LocalDate = string
export type SectionKind = 'top3' | 'other' | 'events' | 'good-stuffs' | 'notes' | 'custom'
export interface NoteBlock {
  id: string
  kind: 'paragraph' | 'task' | 'event' | 'material' | 'reference'
  text: string
  taskId?: string
  eventId?: string
  materialId?: string
  targetPageId?: string
  sourcePageId?: string
  sourceBlockId?: string
}
export interface Section { id: string; kind: SectionKind; title: string; blocks: NoteBlock[] }
export interface Page {
  id: string; type: 'daily' | 'document'; date: LocalDate | null; title: string
  sections: Section[]; reviewText: string; reviewSaved: boolean; handoffDone: boolean
  draft: { simulated: true; taskIds: string[]; materialIds: string[]; text: string } | null
}
export interface Task {
  id: string; title: string; status: 'open' | 'done' | 'cancelled'; version: number
  plannedOn: LocalDate | null; attentionOn: LocalDate | null; deadlineOn: LocalDate | null
  paused: boolean; createdOn: LocalDate; lastPlannedOn: LocalDate | null; sourcePageId: string
}
export interface Event { id: string; title: string; date: LocalDate; time: string | null; cancelled: boolean }
export interface Placement { taskId: string; date: LocalDate; state: 'included' | 'excluded' | 'moved'; section: 'top3' | 'other' }
export interface Material {
  id: string; url: string; title: string; body: string; savedOn: LocalDate
  reviewState: 'pending' | 'watching' | 'lower' | 'done'; nextReviewOn: LocalDate | null
  resurface: boolean; lastDecisionOn: LocalDate | null
  sources: { pageId: string; blockId: string; note: string }[]
}
export interface Capture {
  id: string; pageId: string; text: string; status: 'needs_confirmation' | 'applied' | 'discarded'
  proposalRevision: number; simulated: true; proposedTitle: string; taskId?: string
}
export interface Receipt { operationId: string; message: string; entityId?: string; simulated?: boolean }
export interface Workspace {
  schemaVersion: 1; revision: number; timezone: 'America/Vancouver'
  pages: Page[]; tasks: Task[]; events: Event[]; placements: Placement[]; materials: Material[]
  captures: Capture[]; receipts: Record<string, Receipt>
}
export type Action =
  | { type: 'ensure-day'; date: LocalDate }
  | { type: 'rename-section'; pageId: string; sectionId: string; title: string }
  | { type: 'add-section'; pageId: string; title: string }
  | { type: 'remove-section'; pageId: string; sectionId: string }
  | { type: 'add-text'; pageId: string; sectionId: string; text: string }
  | { type: 'edit-block'; pageId: string; blockId: string; text: string }
  | { type: 'remove-blocks'; pageId: string; blockIds: string[]; bulk: boolean; today: LocalDate }
  | { type: 'add-task'; pageId: string; sectionId: string; title: string; plannedOn?: LocalDate | null; attentionOn?: LocalDate | null; deadlineOn?: LocalDate | null }
  | { type: 'task-status'; taskId: string; status: Task['status'] }
  | { type: 'plan-task'; taskId: string; date: LocalDate; section?: 'top3' | 'other' }
  | { type: 'not-today'; taskId: string; date: LocalDate }
  | { type: 'add-event'; pageId: string; title: string; date: LocalDate; time?: string | null }
  | { type: 'keep-block'; sourcePageId: string; blockId: string; targetDate: LocalDate }
  | { type: 'handoff-done'; date: LocalDate }
  | { type: 'save-review'; date: LocalDate; text: string; finish: boolean }
  | { type: 'save-material'; pageId: string; sectionId: string; url: string; title: string; body?: string; note?: string }
  | { type: 'review-material'; materialId: string; decision: 'watching' | 'lower' | 'done' | 'task'; date: LocalDate; nextReviewOn?: LocalDate }
  | { type: 'material-resurface'; materialId: string; enabled: boolean }
  | { type: 'create-document'; title: string; body: string }
  | { type: 'insert-reference'; pageId: string; sectionId: string; targetPageId: string }
  | { type: 'capture'; pageId: string; text: string }
  | { type: 'edit-capture'; captureId: string; title: string; proposalRevision: number }
  | { type: 'apply-capture'; captureId: string; proposalRevision: number }
  | { type: 'discard-capture'; captureId: string }
  | { type: 'generate-draft'; date: LocalDate }
  | { type: 'undo'; targetOperationId: string }
export interface Command { operationId: string; expectedRevision: number; action: Action }
export interface CommandResult { workspace: Workspace; receipt: Receipt }
export interface DayView {
  page: Page | null; planned: Task[]; attention: Task[]; carry: Task[]
  handoffTasks: Task[]; handoffBlocks: { pageId: string; block: NoteBlock }[]
  openPool: Task[]; paused: Task[]; events: Event[]; materialReview: Material[]
}
