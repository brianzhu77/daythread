// Shot 1 (docs: "Recommended model"): two stored records. A Page holds its editor document, the one copy of what was
// written; a Task holds what is true of a to-do wherever it appears. Everything else (planned-on, order, carry-over,
// events, tags, links) is read from the documents and never stored.
export type LocalDate = string;

export interface Page {
  id: string;
  /** `template`: the day template (B70), one per workspace, copied into each new day page; never listed as a page. */
  type: "daily" | "document" | "template";
  /** Day pages: their date; one page per date, id `day:<date>`. */
  date: LocalDate | null;
  title: string;
  /** A bookmark page's URL exactly as pasted; one page per URL (urlKey). */
  url?: string | null;
  /** The page it was created in; null or absent = top level. Day pages never have one. */
  parentId?: string | null;
  /** Set while the page is in the trash (ISO time of the delete); null or absent = live. */
  trashedAt?: string | null;
  /** The delete's operation id, shared by every page trashed with it. */
  trashId?: string | null;
  /** The editor document (BlockNote JSON, `EditorNode[]`): headings, lines, task rows, cards, chips, links. */
  document: string;
  /** Day pages: the morning card was closed with Done. */
  handoffDone?: boolean;
  /** Day pages: the evening review was saved. */
  reviewSaved?: boolean;
}

export interface Task {
  id: string;
  title: string;
  status: "open" | "done" | "cancelled";
  version: number;
  /** Not today: set aside, never carried until planned again. */
  paused: boolean;
  deadlineOn: LocalDate | null;
  /** The start date: shown as "Start" in Upcoming and under Due soon. */
  attentionOn: LocalDate | null;
  createdOn: LocalDate;
  sourcePageId: string;
  /** The day it was marked done; null when open or cancelled. */
  doneOn?: LocalDate | null;
}

export interface Receipt {
  operationId: string;
  message: string;
  entityId?: string;
  fingerprint?: string;
}

export interface Workspace {
  schemaVersion: 2;
  revision: number;
  timezone: string;
  pages: Page[];
  tasks: Task[];
  /** Tasks deleted with their last line (newest last, at most `tombstoneLimit`), so ⌘Z brings one back whole. */
  deletedTasks: Task[];
  receipts: Record<string, Receipt>;
  undo?: {
    operationId: string;
    revision: number;
    /** Server only: the browser gets the marker without the copy (`src/server/browser-workspace.ts`). */
    before?: Omit<Workspace, "undo">;
  };
}

export type Action =
  | {
      type: "save-editor";
      pageId: string;
      /** `pageContentKey` of the page the editor started from; a stale save is refused whole. */
      expectedContent: string;
      document: string;
      /** Rows removed one at a time (a key, a row action): on today's page that is Not today for a task with history. */
      singleDeleteIds?: string[];
      /** Tasks whose rows were cut (a move): never deleted or paused by this save. */
      cutTaskIds?: string[];
      today?: LocalDate;
    }
  | { type: "ensure-day"; date: LocalDate }
  | { type: "add-task"; pageId: string; title: string; plannedOn?: LocalDate | null; attentionOn?: LocalDate | null; deadlineOn?: LocalDate | null }
  | { type: "task-status"; taskId: string; status: Task["status"]; today?: LocalDate }
  /** `from`: the day page the move is made from, with the browser's `today`; its row leaves unless that day is past. */
  | { type: "plan-task"; taskId: string; date: LocalDate; from?: LocalDate; today?: LocalDate }
  /** The morning card's Add / Add all and the review's Done: each task onto `date`, nested as on the previous page. */
  | { type: "plan-tasks"; date: LocalDate; items: { taskId: string }[] }
  /** Not today: set aside (paused) and off that day's page. `onlyThisDay`: a stale row leaves, the task is paused only if that day is its plan. */
  | { type: "not-today"; taskId: string; date: LocalDate; onlyThisDay?: true }
  /** The task's rows leave this page; a task born here with no other row goes with them (the review's Remove). */
  | { type: "remove-task-row"; pageId: string; taskId: string; today: LocalDate }
  | { type: "bring-line"; date: LocalDate; sourcePageId: string; sourceBlockId: string }
  | { type: "handoff-done"; date: LocalDate }
  | { type: "save-review"; date: LocalDate }
  | { type: "create-document"; title: string; body: string; pageId?: string; parentId?: string }
  /** URLs pasted as bookmarks: one page per URL, made under `parentPageId`, reused if live, restored if trashed. */
  | { type: "make-link-pages"; parentPageId: string; items: { url: string; pageId: string; title?: string }[] }
  /** The page's title and a quote read from the web, applied only while the page is as the paste left it. */
  | { type: "apply-link-preview"; pageId: string; url: string; title: string | null; description: string | null }
  | { type: "rename-page"; pageId: string; title: string }
  | { type: "move-page"; pageId: string; parentId: string | null }
  | { type: "delete-page"; pageId: string; at: string }
  | { type: "restore-page"; pageId: string }
  | { type: "restore-batch"; trashId: string }
  /** The account's time zone (an IANA name), used for conversions and the export's date. */
  /** A new template under Templates; `dayPage`: a copy of the built-in day headings, made the day pages' default. */
  | { type: "create-template"; title: string; pageId?: string; dayPage?: true }
  /** What a template is the default for (one template per target); null: nothing. */
  | { type: "set-template-target"; pageId: string; target: "days" | null }
  | { type: "set-timezone"; timezone: string }
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

/** One event on a day, read from a `@date` chip; `line` is where the chip is. */
export interface EventLine { pageId: string; lineId: string }
export interface DayEvent { id: string; title: string; date: LocalDate; time: string | null; line?: EventLine }

export interface DayView {
  page: Page | null;
  /** Open tasks with a plan row on this day's page, in document order. */
  planned: Task[];
  /** Every task with a plan row on this day's page, any status, in document order. */
  dayTasks: Task[];
  attention: Task[];
  carry: Task[];
  handoffTasks: Task[];
  /** Lines of the previous day page that can be brought to this day. */
  handoffBlocks: { pageId: string; block: import("./editor-document.ts").EditorNode }[];
  openPool: Task[];
  paused: Task[];
  events: DayEvent[];
}
