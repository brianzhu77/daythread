// Morning proposals (v05 morning card step 3): lines from earlier pages that are real to-dos for today.
// The model only chooses and words; the app shows them as proposals and Brian adds the ones he wants.

export interface MorningContext { today: string; weekday: string; timezone: string }
export interface MorningLine { id: string; pageDate: string; pageWeekday: string; section: string; text: string }
export interface MorningAnswer { proposals: { lineId: string; propose: boolean; title: string | null; date: string | null; reason: string }[] }

export const morningSchema = {
  name: 'morning_proposals',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['proposals'],
    properties: {
      proposals: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['lineId', 'propose', 'title', 'date', 'reason'],
          properties: {
            lineId: { type: 'string' },
            propose: { type: 'boolean' },
            title: { type: ['string', 'null'] },
            date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            reason: { type: 'string' },
          },
        },
      },
    },
  },
} as const

export function morningMessages(lines: MorningLine[], ctx: MorningContext) {
  const system = `Each morning Brian sees a short list of lines from earlier days that he might want to do today. Decide, for each line below, whether it is a real to-do that is still open.

Today: ${ctx.weekday} ${ctx.today} (${ctx.timezone}).

Rules:
- Propose only lines where he says he will or should do something that hasn't happened yet. Diary lines, things already done, and observations are not proposed.
- "If I have time / maybe / 如果有空" is optional: proposing it is allowed, but never give it a date.
- Resolve relative dates from the day the line was written (shown with each line), not from today. A day that falls on today means today. Never date anything earlier than today.
- title: his words, his language, shortened only if needed. Never translate, never add details.
- reason: one short line saying where it came from, e.g. "Fri · Notes".
Return one entry per line, in the same order. Answer with JSON only.`
  const user = lines.map(l => `[${l.id}] (${l.pageWeekday} ${l.pageDate} · ${l.section}) ${l.text}`).join('\n')
  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}
