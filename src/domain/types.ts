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
  /** A6b: the source line's fingerprint when a proposal was accepted (text, type and date basis at that time). */
  sourceFingerprint?: string;
  /** B15: a card's time, the revision of the save that first held it (plan a9-page-links §2). Absent = not stamped yet. */
  at?: number;
  /** A9a: the `[[` links in this line, one per link, with the title they showed when the line was saved. */
  refs?: PageRefEntry[];
  /** A2 plan §4: what one pasted card did, kept in `editorBlockMetadata["paste:" + cardBlockId]` so Undo can be checked. */
  linkPaste?: LinkPasteRecord;
  /** On `heading:<id>` entries: the section's role, so a heading that comes back (Undo, cut and paste) keeps it. */
  sectionKind?: SectionKind;
  /** A11: on a task row's metadata entry, the revision of the last save that had the row on this page (recency order). */
  seen?: number;
}
/** A9a plan §1–§2: one inline `[[` link. `refId` is this link's identity; `at` the revision that first saw it. */
export interface PageRefEntry {
  refId: string;
  pageId: string;
  at: number;
  /** The target's title when the line was last saved, so the line's stored text can be compared and read. */
  title: string;
  /** A link to a page still being created (plan §4); readers go by whether the page exists, not by this. */
  pending?: boolean;
  /** A11: a link to one line of that page (block or custom heading id), and the line's task when it's a task row. */
  lineId?: string;
  taskId?: string;
}
/** A2 plan §4: the outcome of one URL of a paste. Never pruned, so it outlives the card. */
export interface LinkPasteRecord {
  operationId: string;
  cardBlockId: string;
  outcome: "made" | "reused" | "restored";
  pageId: string;
  url: string;
  /** The line the card replaced (paragraph, bullet, numbered), so Undo puts back the same kind of line. */
  lineType: string;
  /** A made page's first title (the link text, or the URL default), so Undo can tell a rename. B43: or the title read
   * from the web, which isn't his edit either. */
  title?: string;
  /** B43: the description quote the preview put on the made page, and the whole body it wrote, so Undo doesn't count
   * that as his writing, while any change to it (a word, a format, the quote turned into a bullet) does. */
  preview?: { blockId: string; text: string; document: string };
  /** The day of the paste, for "Saved before · {day}". */
  on: LocalDate;
  /** References (`pageId/blockId`) to each page of the outcome at paste time; only ones added since block Undo. */
  refsBefore: string[];
  restored?: { pageId: string; trashId: string; trashedAt: string; parentBefore: string | null; parentAfter: string | null }[];
  /** Pasted under Good Stuffs: the follow-up record this card saved to, and whether this paste made it. */
  materialId?: string;
  materialCreated?: boolean;
  /** A "Done with it" item this paste put back to To sort, so Undo can return it if nothing changed since. */
  materialBefore?: { reviewState: Material["reviewState"]; nextReviewOn: LocalDate | null; skippedUntil: LocalDate | null; savedOn: LocalDate; decisions: number };
  /** Set by Undo: the card is the plain URL line again, which Good Stuffs doesn't collect until it's edited. */
  undone?: boolean;
}
/** A6b plan §4a: why a real Draft my day run ended without a result. */
export type DraftFailure = "key-rejected" | "unavailable" | "paused" | "budget" | "too-large" | "busy";
/** A6b plan §5: exactly what one run sent to the model. */
export interface DraftManifest {
  lines: { lineId: string; pageId: string; blockId: string; fingerprint: string }[];
  sentPages: string[];
  omittedPages: string[];
  taskCandidates: string[];
  materialCandidates: string[];
}
/** A6b plan §4a: one real run of Draft my day, bound to the operation that started it. */
export interface DraftRun {
  runId: string;
  run: number;
  trigger: "card";
  startedAt: string;
  status: "drafting" | "ready" | "failed" | "expired";
  attemptId: string;
  model: string;
  requestHash: string;
  failure?: DraftFailure;
  /** The charge couldn't be confirmed (an estimate, or a generation id without a cost): the card adds "Cost unknown". */
  costUnknown?: boolean;
  manifest: DraftManifest;
}
/** A6b: a line from his own writing the model chose; the title is always the line itself, read when shown. */
export interface DraftProposal {
  lineId: string;
  pageId: string;
  blockId: string;
  fingerprint: string;
  date: LocalDate | null;
}
export interface Section {
  id: string;
  kind: SectionKind;
  title: string;
  blocks: NoteBlock[];
  /** A9a: `[[` links in the heading itself (Ratchet #84: a heading is a line like any other). */
  refs?: PageRefEntry[];
}
export interface Page {
  id: string;
  type: "daily" | "document";
  date: LocalDate | null;
  title: string;
  /** A2: a link page's URL exactly as first pasted. The page is the only owner of its key (`urlKey`). */
  url?: string | null;
  /** The page it was created in (pages-delta N-2); null or absent = top level. Day pages never have one. */
  parentId?: string | null;
  /** A4: set while the page is in the trash (ISO time of the delete); null or absent = live. */
  trashedAt?: string | null;
  /** A4: the delete's operation id, shared by the page and every page trashed with it (the batch). */
  trashId?: string | null;
  sections: Section[];
  editorJSON?: string;
  /** Set once the day template's starter rows have been saved, so rows the user deletes stay deleted. */
  templateApplied?: boolean;
  editorSections?: string;
  editorBlockMetadata?: Record<string, NoteBlock>;
  editorCreations?: Record<string, string>;
  /** `deleted`: B33, the task itself went with its line (born on this page, no history); ⌘Z brings it back. */
  editorDeletions?: Record<string, { task: Task; placements: Placement[]; afterVersion: number; afterPlacements: Placement[]; deleted?: true }>;

  reviewText: string;
  reviewSaved: boolean;
  handoffDone: boolean;
  reviewStep?: number;
  reviewSource?: "reminder" | "direct";
  reviewSkipped?: boolean;
  draftError?: string;
  draft: {
    simulated: boolean;
    taskIds: string[];
    materialIds: string[];
    text: string;
    /** A6b: present for a real Draft my day run (and its simulated stand-in from the card). */
    run?: DraftRun;
    proposals?: DraftProposal[];
    /** lineIds hidden for this day (Hide for today). */
    hidden?: string[];
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
  /** A11: the day it was marked done (where a link to it goes); null when open or cancelled, absent before A11. */
  doneOn?: LocalDate | null;
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
  /** `plain`: B44, a link pasted and kept as a plain link on that line; the record goes with the line (B33's rule). */
  sources: { pageId: string; blockId: string; note: string; plain?: true }[];
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
  before?: { status: Task["status"]; doneOn?: LocalDate | null; plannedOn: LocalDate | null; deadlineOn: LocalDate | null; attentionOn: LocalDate | null; placements: Placement[] };
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
    /** Server only: the browser gets the marker without the copy (`src/server/browser-workspace.ts`). */
    before?: Omit<Workspace, "undo">;
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
  | { type: "retry-capture"; captureId: string }
  | { type: "start-draft-run"; date: LocalDate; model: string; startedAt: string }
  | { type: "record-draft-request"; date: LocalDate; runId: string; requestHash: string; manifest: DraftManifest }
  | { type: "set-model-draft"; date: LocalDate; runId: string; taskIds: string[]; materialIds: string[]; proposals: DraftProposal[] }
  | { type: "model-draft-failed"; date: LocalDate; runId: string; failure: DraftFailure; expired?: boolean; costUnknown?: boolean };
export type Action =
  | { type: "plan-tasks"; date: LocalDate; items: { taskId: string; section: "top3" | "other" }[] }
  | { type: "bring-line"; date: LocalDate; sourcePageId: string; sourceBlockId: string }
  | { type: "save-editor"; pageId: string; expectedContent: string; document: string; singleDeleteIds?: string[]; /** B33: tasks whose rows were cut (a move), never deleted with their line. */ cutTaskIds?: string[]; today?: string; historyTaskVersions?: Record<string, number>; history?: boolean }
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
  | { type: "task-status"; taskId: string; status: Task["status"]; today?: LocalDate }
  /** B33 one-time cleanup (server script only): tasks with no line anywhere that were born on their page; undoable. */
  | { type: "delete-orphan-tasks"; taskIds: string[] }
  | {
      type: "plan-task";
      taskId: string;
      date: LocalDate;
      section?: "top3" | "other";
      /** A12 §2: the row leaves this day page in the same command, unless `from` is before `today`. Needs `today`. */
      from?: LocalDate;
      today?: LocalDate;
    }
  /** `onlyThisDay` (A12 §1): pause only if the task is still planned for `date`; otherwise remove just that page's row. */
  | { type: "not-today"; taskId: string; date: LocalDate; onlyThisDay?: true }
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
  /** A2: URLs pasted onto an empty line of `pageId`, one card each, in order. `sectionId`: the heading above them. */
  | { type: "paste-links"; pageId: string; sectionId?: string; today: LocalDate; items: { url: string; pageId: string; cardBlockId: string; lineType: string; title?: string }[] }
  | { type: "undo-paste-links"; pageId: string; operationId: string; today: LocalDate }
  /** B44: links pasted and kept as plain links (the menu's default): each still recorded, with no page, on its line. */
  | { type: "save-plain-link"; pageId: string; items: { blockId: string; url: string }[] }
  /** B43: a made link page's title and description, read from the web after the paste; applied only to that untouched page. */
  | { type: "apply-link-preview"; parentPageId: string; cardBlockId: string; pageId: string; url: string; title: string | null; description: string | null }
  | { type: "rename-page"; pageId: string; title: string }
  | { type: "move-page"; pageId: string; parentId: string | null }
  | { type: "delete-page"; pageId: string; at: string }
  | { type: "restore-page"; pageId: string }
  | { type: "restore-batch"; trashId: string }
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
      /** "card": Draft my day on the morning card (adds the example proposal when simulated); absent: the review. */
      trigger?: "card";
    }
  | { type: "add-proposal"; date: LocalDate; lineId: string }
  | { type: "hide-proposal"; date: LocalDate; lineId: string }
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
