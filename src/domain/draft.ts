// A6b (docs/plan/a6b-model-step2.md): the parts of Draft my day the app decides, never the model — which lines go out,
// whether a line was already carried forward, a line's fingerprint, and the date a line itself names.
import { isTrashed } from "./page-tree.ts";
import type { DraftProposal, LocalDate, NoteBlock, Page, Workspace } from "./types.ts";

/** One line of his own writing that may be sent: `lineId` = `pageId/blockId`. */
export interface DraftLine {
  lineId: string;
  pageId: string;
  blockId: string;
  section: string;
  text: string;
  kind: NoteBlock["kind"];
}

/** The most recent day page before `day` that isn't empty of pages (day pages are never trashed). */
export function previousDayPage(ws: Workspace, day: LocalDate): Page | undefined {
  return ws.pages
    .filter((p) => p.type === "daily" && p.date !== null && p.date < day)
    .sort((a, b) => (a.date! < b.date! ? 1 : -1))[0];
}

/**
 * The line was already carried forward: some page holds a row whose source is this line — a task made from a proposal
 * or a line brought to today. Rows are found in sections and in `editorBlockMetadata`; the metadata is what keeps a
 * deleted row counting, and it depends on save-editor never pruning a deleted block's metadata (as `wasBrought`, A8).
 * The test "delete the row, still not offered" deletes through save-editor, so it fails if that ever changes. Undo
 * restores the whole workspace from before, so an undone accept offers the line again.
 */
export function isLineLinked(ws: Workspace, pageId: string, blockId: string): boolean {
  return ws.pages.some((p) =>
    [...p.sections.flatMap((s) => s.blocks), ...Object.values(p.editorBlockMetadata ?? {})].some((b) => b.sourcePageId === pageId && b.sourceBlockId === blockId),
  );
}

/** Text and link lines; never tasks, page cards, events or empty rows. */
export function draftLines(page: Page): DraftLine[] {
  return page.sections.flatMap((s) =>
    s.blocks
      .filter((b) => (b.kind === "paragraph" || b.kind === "material") && !b.taskId && !b.targetPageId && !b.eventId && b.text.trim())
      .map((b) => ({ lineId: `${page.id}/${b.id}`, pageId: page.id, blockId: b.id, section: s.title, text: b.text, kind: b.kind })),
  );
}

/** One hop: pages behind cards on these pages, in order, without repeats, trashed or missing pages, or the pages themselves. */
export function linkedPages(ws: Workspace, from: Page[]): Page[] {
  const out: Page[] = [];
  const seen = new Set(from.map((p) => p.id));
  for (const p of from)
    for (const b of p.sections.flatMap((s) => s.blocks)) {
      if (b.kind !== "reference" || !b.targetPageId || seen.has(b.targetPageId)) continue;
      const target = ws.pages.find((x) => x.id === b.targetPageId);
      seen.add(b.targetPageId);
      if (target && !isTrashed(target)) out.push(target);
    }
  return out;
}

/** The day relative words on this page count from: its own date, or the day page it sits under; none at top level. */
export function dateBasis(ws: Workspace, page: Page): LocalDate | null {
  const seen = new Set<string>();
  for (let p: Page | undefined = page; p && !seen.has(p.id); p = p.parentId ? ws.pages.find((x) => x.id === p!.parentId) : undefined) {
    seen.add(p.id);
    if (p.type === "daily" && p.date) return p.date;
  }
  return null;
}

/** FNV-1a over the line's type, text and date basis: an edit, or a move under another day, changes it. */
export function lineFingerprint(kind: string, text: string, basis: LocalDate | null): string {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify([kind, text, basis])) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
export function fingerprintOf(ws: Workspace, page: Page, block: NoteBlock): string {
  return lineFingerprint(block.kind, block.text, dateBasis(ws, page));
}

const addDays = (d: LocalDate, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const weekdayOf = (d: LocalDate) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
const realDate = (y: number, m: number, d: number): LocalDate | null => {
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return new Date(`${s}T12:00:00Z`).toISOString().startsWith(s) ? s : null;
};
const zhDay: Record<string, number> = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 };
const enDay = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
/** Words that name a span, not one day: a line that has one gets no date. */
const spans = /下周(?![一二三四五六日天])|下星期(?![一二三四五六日天])|周末|月底|月初|下个月|这周|本周|这个月|next week|this week|weekend|next month|end of the month/i;
const someday = /如果有空|有空的话|有时间的话|有空可以|也许|或许|maybe|if i have time|someday|some day/i;

/**
 * The one day this line names, resolved from `basis` (the page's date) for relative words. Null when it names no day,
 * more than one, a span ("下周"), or a relative day with no basis. `year` resolves "10月23日" and "10/23".
 */
export function resolveLineDate(text: string, basis: LocalDate | null, year: number): LocalDate | null {
  if (spans.test(text)) return null;
  const found = new Set<LocalDate | null>();
  const rel = (n: number) => found.add(basis ? addDays(basis, n) : null);
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) found.add(realDate(+m[1]!, +m[2]!, +m[3]!));
  for (const m of text.matchAll(/(\d{1,2})月(\d{1,2})[日号]/g)) found.add(realDate(year, +m[1]!, +m[2]!));
  for (const m of text.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) found.add(realDate(year, +m[1]!, +m[2]!));
  for (const m of text.matchAll(/大后天|后天|明天|明日|今天|今日/g)) rel({ 大后天: 3, 后天: 2, 明天: 1, 明日: 1, 今天: 0, 今日: 0 }[m[0]]!);
  for (const m of text.matchAll(/\b(day after tomorrow|tomorrow|today|tonight)\b/gi)) rel({ "day after tomorrow": 2, tomorrow: 1, today: 0, tonight: 0 }[m[1]!.toLowerCase()]!);
  // 下周三: the Wednesday of next week (weeks start Monday). 周三 alone: the next Wednesday on or after the basis.
  for (const m of text.matchAll(/(下)?(?:周|星期|礼拜)([一二三四五六日天])/g)) {
    if (!basis) { found.add(null); continue; }
    const target = zhDay[m[2]!]!, cur = weekdayOf(basis);
    found.add(m[1] ? addDays(basis, 7 - cur + target) : addDays(basis, (target - cur + 7) % 7));
  }
  for (const m of text.matchAll(/\b(next\s+)?(mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b/gi)) {
    if (!basis) { found.add(null); continue; }
    const target = enDay.indexOf(m[2]!.toLowerCase()), cur = weekdayOf(basis);
    found.add(addDays(basis, m[1] ? ((target - cur + 7) % 7 || 7) : (target - cur + 7) % 7));
  }
  if (found.size !== 1) return null;
  return [...found][0] ?? null;
}

/**
 * Keep the model's date only when the app reads the same single day from the line, on or after the day drafted
 * (Ratchet ae9c7b87 3). "If I have time" lines never keep one. When unsure: no date, never a guess (Jazz).
 */
export function checkedDate(modelDate: string | null, text: string, basis: LocalDate | null, day: LocalDate): LocalDate | null {
  if (!modelDate || someday.test(text)) return null;
  const parsed = resolveLineDate(text, basis, Number(day.slice(0, 4)));
  return parsed && parsed === modelDate && parsed >= day ? parsed : null;
}

/** A proposal still stands when its line is there, unchanged (fingerprint), its page isn't trashed and it isn't linked. */
export function liveProposal(ws: Workspace, p: DraftProposal): { page: Page; block: NoteBlock; section: string } | null {
  const page = ws.pages.find((x) => x.id === p.pageId);
  if (!page || isTrashed(page)) return null;
  const section = page.sections.find((s) => s.blocks.some((b) => b.id === p.blockId));
  const block = section?.blocks.find((b) => b.id === p.blockId);
  if (!section || !block || !block.text.trim()) return null;
  if (fingerprintOf(ws, page, block) !== p.fingerprint) return null;
  if (isLineLinked(ws, page.id, block.id)) return null;
  return { page, block, section: section.title };
}
