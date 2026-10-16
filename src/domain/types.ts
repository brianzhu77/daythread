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
  sections: Section[];
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
  status: "needs_confirmation" | "applied" | "discarded" | "failed";
  contextLine?: string;
  error?: string;
  failure?: "failure" | "budget" | "context";
  proposals?: ProposalItem[];
  proposalRevision: number;
  simulated: true;
  proposedTitle: string;
  taskId?: string;
}
export interface ProposalItem {
  id: string;
  kind: "create-task" | "create-material" | "update-task";
  title: string;
  url?: string;
  taskId?: string;
  expectedVersion?: number;
  status?: Task["status"];
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
export type Action =
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
  | { type: "create-document"; title: string; body: string }
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
  | {
      type: "generate-draft";
      date: LocalDate;
      outcome?: "success" | "failure" | "budget" | "context";
    }
  | { type: "undo"; targetOperationId: string };
export interface Command {
  operationId: string;
  expectedRevision: number;
  action: Action;
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
