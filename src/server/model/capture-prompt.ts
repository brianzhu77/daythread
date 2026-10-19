// The capture contract the model answers to (03 §1, §5). The app owns every decision the schema leaves open:
// it checks ids, dates and versions, and nothing here is applied without the existing apply/confirm flow.

export interface CaptureContext {
  /** Local date and time the text was captured, e.g. "2026-10-19 09:00", plus its weekday. */
  capturedAt: string
  weekday: string
  timezone: string
  /** Open tasks Brian may be referring to; the model may only point at these ids. */
  openTasks: { id: string; title: string; plannedOn: string | null; deadlineOn: string | null }[]
}

export type CaptureItem =
  | { kind: 'task'; title: string; date: string | null; dateRole: 'do' | 'due' | null; detail: string | null }
  | { kind: 'event'; title: string; date: string | null; time: string | null; partOfDay: 'morning' | 'afternoon' | 'evening' | null }
  | { kind: 'note'; text: string }
  | { kind: 'material'; url: string; note: string | null; followUpDate: string | null }
  | { kind: 'update'; taskId: string; markDone: boolean; newDate: string | null; dateRole: 'do' | 'due' | null; detail: string | null }

export interface CaptureAnswer { items: CaptureItem[] }

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, 'null'], ...extra })
const date = { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }

/**
 * Strict JSON schema for OpenRouter `response_format`: one flat item shape with a `kind` enum (fields that don't
 * apply are null), and task ids limited to the open tasks actually sent, so an update can't point at nothing.
 */
export function captureSchema(openTaskIds: readonly string[]) {
  const fields = {
    kind: { type: 'string', enum: ['task', 'event', 'note', 'material', 'update'] },
    title: nullable('string'), text: nullable('string'), detail: nullable('string'),
    date: nullable('string', date), dateRole: nullable('string', { enum: ['do', 'due', null] }),
    time: nullable('string', { pattern: '^\\d{2}:\\d{2}$' }), partOfDay: nullable('string', { enum: ['morning', 'afternoon', 'evening', null] }),
    url: nullable('string'), note: nullable('string'), followUpDate: nullable('string', date),
    taskId: openTaskIds.length ? nullable('string', { enum: [...openTaskIds, null] }) : { type: 'null' },
    markDone: nullable('boolean'), newDate: nullable('string', date),
  }
  return {
    name: 'capture', strict: true,
    schema: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: Object.keys(fields), properties: fields } } } },
  }
}
type FlatItem = { kind: CaptureItem['kind']; title: string | null; text: string | null; detail: string | null; date: string | null; dateRole: 'do' | 'due' | null; time: string | null; partOfDay: 'morning' | 'afternoon' | 'evening' | null; url: string | null; note: string | null; followUpDate: string | null; taskId: string | null; markDone: boolean | null; newDate: string | null }
/** Narrows the flat answer to typed items; an item missing what its kind needs is dropped, never guessed. */
export function captureItems(answer: { items: FlatItem[] }): CaptureItem[] {
  return answer.items.flatMap((i): CaptureItem[] => {
    switch (i.kind) {
      case 'task': return i.title ? [{ kind: 'task', title: i.title, date: i.date, dateRole: i.dateRole, detail: i.detail }] : []
      case 'event': return i.title ? [{ kind: 'event', title: i.title, date: i.date, time: i.time, partOfDay: i.partOfDay }] : []
      case 'note': return i.text ?? i.title ? [{ kind: 'note', text: (i.text ?? i.title)! }] : []
      case 'material': return i.url ? [{ kind: 'material', url: i.url, note: i.note, followUpDate: i.followUpDate }] : []
      case 'update': return i.taskId ? [{ kind: 'update', taskId: i.taskId, markDone: !!i.markDone, newDate: i.newDate, dateRole: i.dateRole, detail: i.detail }] : []
      default: return []
    }
  })
}
export type CaptureRawAnswer = { items: FlatItem[] }

export function captureMessages(text: string, ctx: CaptureContext) {
  const tasks = ctx.openTasks.length
    ? ctx.openTasks.map(t => `- id=${t.id} · "${t.title}"${t.plannedOn ? ` · planned ${t.plannedOn}` : ''}${t.deadlineOn ? ` · due ${t.deadlineOn}` : ''}`).join('\n')
    : '(none)'
  const system = `You turn one short note Brian typed into structured items for his daily planner. You only propose; the app decides.

Now: ${ctx.weekday} ${ctx.capturedAt} (${ctx.timezone}). Resolve every relative date from this moment.

His open tasks (the only ids you may reference):
${tasks}

Rules:
- Keep his words and his language. Never translate, summarise into another language, or add content he didn't write (no invented times, prices, people or tasks).
- task: something he means to do. date = the day it's for; dateRole "due" when he gives a deadline (before / by / 前 / 之前 / 月底), "do" when he names the day to do it. No date given → date null, dateRole null. Never default to today.
- event: something happening at a time or on a day (a meeting, a lunch, a class). time only if he wrote one; "下午 / afternoon" sets partOfDay, not a time.
- note: a thought, idea, diary line or something already done that isn't about an existing task. Not a task unless he commits to doing something.
- material: a URL. A URL on its own is a saved link. URL + words → one material, the words become its note (they are not a separate task). Keep the URL exactly. followUpDate only if he names when to look at it.
- update: when he is clearly talking about one of the open tasks above (done, moved, more detail), reference its id instead of creating a new task. markDone true for "done / 搞定 / 完成". newDate when he moves it.
- Dates: "next <weekday>" means that weekday in the following week (on a Monday, "next Mon" is 7 days later). "下周X" = that weekday next week. "周X" alone = the coming one (today if it is today). Numeric dates like 11/2 are month/day. "月底" = last day of this month. "周末" = the coming Saturday.
- Several things in one note → several items, in his order.
Answer with JSON only.`
  return [{ role: 'system', content: system }, { role: 'user', content: text }]
}
