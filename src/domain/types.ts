export type LocalDate = string;
export type SectionKind =
  | "top3"
  | "other"
  | "events"
  | "good-stuffs"
  | "notes"
  | "custom";
export interface NoteBlock {
  id: string;
  kind: "paragraph" | "task" | "event" | "material" | "reference";
  text: string;
  taskId?: string;
  planRole?: "plan" | "reference";
  eventId?: string;
  materialId?: string;
  targetPageId?: string;
  sourcePageId?: string;
  sourceBlockId?: string;
}
export interface Section {
  id: string;
  kind: SectionKind;
  title: string;
  blocks: NoteBlock[];
}
export interface Page {
  id: string;
  type: "daily" | "document";
  date: LocalDate | null;
  title: string;
  /** The page it was created in (pages-delta N-2); null or absent = top level. Day pages never have one. */
  parentId?: string | null;
  sections: Section[];
  editorJSON?: string;
  /** Set once the day template's starter rows have been saved, so rows the user deletes stay deleted. */
  templateApplied?: boolean;
  editorSections?: string;
  editorBlockMetadata?: Record<string, NoteBlock>;
  editorCreations?: Record<string, string>;
  editorDeletions?: Record<string, { task: Task; placements: Placement[]; afterVersion: number; afterPlacements: Placement[] }>;

  reviewText: string;
  reviewSaved: boolean;
  handoffDone: boolean;
  reviewStep?: number;
  reviewSource?: "reminder" | "direct";
  reviewSkipped?: boolean;
  draftError?: string;
  draft: {
    simulated: true;
    taskIds: string[];
    materialIds: string[];
    text: string;
  } | null;
}
export interface Task {
  id: string;
  title: string;
  status: "open" | "done" | "cancelled";
  version: number;
  plannedOn: LocalDate | null;
  attentionOn: LocalDate | null;
  deadlineOn: LocalDate | null;
  paused: boolean;
  createdOn: LocalDate;
  lastPlannedOn: LocalDate | null;
  sourcePageId: string;
}
export interface Event {
  id: string;
  title: string;
  date: LocalDate;
  time: string | null;
  cancelled: boolean;
}
export interface Placement {
  taskId: string;
  date: LocalDate;
  state: "included" | "excluded" | "moved";
  order?: number;
  section: "top3" | "other";
}
export interface Material {
  id: string;
  url: string;
  title: string;
  body: string;
  savedOn: LocalDate;
  reviewState: "pending" | "watching" | "lower" | "done" | "task";
  nextReviewOn: LocalDate | null;
  resurface: boolean;
  lastDecisionOn: LocalDate | null;
  skippedUntil?: LocalDate | null;
  taskId?: string;
  openedOn?: LocalDate[];
  dismissedOn?: LocalDate[];
  decisions?: { date: LocalDate; decision: string }[];
  sources: { pageId: string; blockId: string; note: string }[];
}
export interface Capture {
  id: string;
  pageId: string;
  text: string;
  /** "organizing": text saved, the model's answer not yet recorded (feat/model step 1). */
  status: "organizing" | "needs_confirmation" | "applied" | "discarded" | "failed";
  contextLine?: string;
  error?: string;
  /** "paused": a cost couldn't be confirmed; like "budget", no Retry until it's settled (Lead 33ae4578). */
  failure?: "failure" | "budget" | "context" | "paused";
  proposals?: ProposalItem[];
  proposalRevision: number;
  simulated: boolean;
  proposedTitle: string;
  taskId?: string;
  /** The model that organized this capture (absent when simulated). */
  model?: string;
  /** ISO instant he submitted the text; every organize run and Retry resolves "明天" from this, not from the call (03 §2). */
  capturedAt?: string;
  /** The captureMode in force when the result was recorded. */
  mode?: "auto" | "confirm";
}
export type GroundingFlag = "title-not-grounded" | "time-not-in-text" | "url-not-in-text" | "task-not-named" | "date-missing" | "date-role-missing";
export interface ProposalItem {
  id: string;
  kind: "create-task" | "create-material" | "update-task" | "create-event" | "add-note";
  title: string;
  url?: string;
  taskId?: string;
  expectedVersion?: number;
  status?: Task["status"];
  /** Model path: the date and what it means (do = planned, due = deadline, start = attention). */
  date?: LocalDate | null;
  dateRole?: "do" | "due" | "start" | null;
  time?: string | null;
  partOfDay?: "morning" | "afternoon" | "evening" | null;
  /** His words on a saved link or a task's detail. */
  note?: string | null;
  /** Grounding: why this item waits for him instead of saving on its own. */
  flags?: GroundingFlag[];
  /** "applied" once it exists; "removed" if he took it out. Absent = waiting. */
  state?: "applied" | "removed";
  /** The task/event/material this proposal created. */
  entityId?: string;
  /** For a created task: its version right after the capture saved it, so Remove / Undo all can tell "edited since". */
  appliedVersion?: number;
  /** What this capture left behind (content and place), so Undo all can tell "edited since" (Ratchet #70). */
  appliedSnapshot?: string;
  /** For a saved task or link: the line this capture added. */
  blockId?: string;
  /** For an applied update: what the task was before, so Remove / Undo all can put it back if nothing changed since. */
  before?: { status: Task["status"]; plannedOn: LocalDate | null; deadlineOn: LocalDate | null; attentionOn: LocalDate | null; placements: Placement[] };
}
export interface Receipt {
  operationId: string;
  message: string;
  entityId?: string;
  simulated?: boolean;
  fingerprint?: string;
}
export interface Workspace {
  schemaVersion: 1;
  revision: number;
  timezone: "America/Vancouver";
  pages: Page[];
  tasks: Task[];
  events: Event[];
  placements: Placement[];
  materials: Material[];
  undo?: {
    operationId: string;
    revision: number;
    before: Omit<Workspace, "undo">;
  };
  captures: Capture[];
  receipts: Record<string, Receipt>;
}
/**
 * Server-only actions (feat/model step 1). They are not in `commandSchema`, so the browser's runCommand can't send
 * them; the server's model orchestrator applies them through the repository.
 */
export type ServerAction =
  | { type: "capture-for-model"; pageId: string; text: string; model: string; capturedAt: string }
  | { type: "organized-capture"; captureId: string; revision: number; model: string; mode: "auto" | "confirm"; proposals: ProposalItem[]; unreadable: number; contextLine: string }
  | { type: "model-failed"; captureId: string; revision: number; failure: "failure" | "budget" | "context" | "paused"; error: string }
  | { type: "retry-capture"; captureId: string };
export type Action =
  | { type: "bring-line"; date: LocalDate; sourcePageId: string; sourceBlockId: string }
  | { type: "save-editor"; pageId: string; expectedContent: string; document: string; singleDeleteIds?: string[]; today?: string; historyTaskVersions?: Record<string, number>; history?: boolean }
  | { type: "ensure-day"; date: LocalDate }
  | { type: "rename-section"; pageId: string; sectionId: string; title: string }
  | { type: "add-section"; pageId: string; title: string }
  | { type: "remove-section"; pageId: string; sectionId: string }
  | { type: "add-text"; pageId: string; sectionId: string; text: string }
  | { type: "edit-block"; pageId: string; blockId: string; text: string }
  | {
      type: "remove-blocks";
      pageId: string;
      blockIds: string[];
      bulk: boolean;
      today: LocalDate;
    }
  | {
      type: "add-task";
      pageId: string;
      sectionId: string;
      title: string;
      plannedOn?: LocalDate | null;
      attentionOn?: LocalDate | null;
      deadlineOn?: LocalDate | null;
    }
  | { type: "task-status"; taskId: string; status: Task["status"] }
  | {
      type: "plan-task";
      taskId: string;
      date: LocalDate;
      section?: "top3" | "other";
    }
  | { type: "not-today"; taskId: string; date: LocalDate }
  | {
      type: "add-event";
      pageId: string;
      title: string;
      date: LocalDate;
      time?: string | null;
    }
  | {
      type: "keep-block";
      sourcePageId: string;
      blockId: string;
      targetDate: LocalDate;
    }
  | {
      type: "keep-planned";
      targetOperationId: string;
      pageId: string;
      blockId: string;
    }
  | { type: "skip-material-review"; materialIds: string[]; date: LocalDate }
  | { type: "open-material"; materialId: string; date: LocalDate }
  | { type: "dismiss-material"; materialId: string; date: LocalDate }
  | {
      type: "review-progress";
      date: LocalDate;
      step: number;
      source?: "reminder" | "direct";
      skip?: boolean;
    }
  | { type: "handoff-done"; date: LocalDate }
  | { type: "save-review"; date: LocalDate; text: string; finish: boolean }
  | {
      type: "save-material";
      pageId: string;
      sectionId: string;
      url: string;
      title: string;
      body?: string;
      note?: string;
    }
  | {
      type: "review-material";
      materialId: string;
      decision: "watching" | "lower" | "done" | "task";
      date: LocalDate;
      nextReviewOn?: LocalDate;
    }
  | { type: "material-resurface"; materialId: string; enabled: boolean }
  | { type: "create-document"; title: string; body: string; pageId?: string; parentId?: string }
  | { type: "rename-page"; pageId: string; title: string }
  | { type: "move-page"; pageId: string; parentId: string | null }
  | { type: "relink-material-lines" }
  | {
      type: "insert-reference";
      pageId: string;
      sectionId: string;
      targetPageId: string;
    }
  | {
      type: "capture";
      pageId: string;
      text: string;
      outcome?: "success" | "failure" | "budget" | "context";
      updateTaskId?: string;
    }
  | {
      type: "edit-capture";
      captureId: string;
      title: string;
      proposalRevision: number;
      removeItemId?: string;
    }
  | { type: "apply-capture"; captureId: string; proposalRevision: number }
  | { type: "discard-capture"; captureId: string }
  | { type: "edit-capture-item"; captureId: string; itemId: string; title?: string; kind?: "create-task" | "create-event" | "add-note"; date?: LocalDate | null; dateRole?: "do" | "due" | "start"; time?: string | null }
  | { type: "save-capture-item"; captureId: string; itemId: string }
  | { type: "remove-capture-item"; captureId: string; itemId: string }
  | { type: "undo-capture"; captureId: string }
  | {
      type: "generate-draft";
      date: LocalDate;
      outcome?: "success" | "failure" | "budget" | "context";
    }
  | { type: "save-draft"; date: LocalDate; taskIds: string[]; materialIds: string[] }
  | { type: "undo"; targetOperationId: string };
export interface Command {
  operationId: string;
  expectedRevision: number;
  action: Action | ServerAction;
}
export interface CommandResult {
  workspace: Workspace;
  receipt: Receipt;
}
export interface DayView {
  page: Page | null;
  planned: Task[];
  attention: Task[];
  carry: Task[];
  handoffTasks: Task[];
  handoffBlocks: { pageId: string; block: NoteBlock }[];
  openPool: Task[];
  paused: Task[];
  events: Event[];
  materialReview: Material[];
}
