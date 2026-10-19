// Model quality probe (docs/validation/model-quality-probe.md @ 1059f08, frozen before any call).
// Spends real money: every call is admitted only if spent + this call's worst case stays under the cap (Ratchet),
// a missing cost counts at its worst case, and every raw answer is kept, failed ones included.
//   node --env-file=<repo>/.env.local scripts/model-probe.ts <out dir> [cap USD = 0.50]
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { callStructured, modelConfig, ModelError } from '../src/server/model/openrouter.ts'
import { captureItems, captureMessages, captureSchema, type CaptureAnswer, type CaptureItem, type CaptureRawAnswer } from '../src/server/model/capture-prompt.ts'
import { morningMessages, morningSchema, type MorningAnswer } from '../src/server/model/morning-prompt.ts'

const out = process.argv[2] ?? '/tmp/model-probe', cap = Number(process.argv[3] ?? 0.5), runs = 3, maxTokens = 1200
mkdirSync(out, { recursive: true })
const config = modelConfig(); if (!config) throw new Error('OPENROUTER_API_KEY / OPENROUTER_MODEL not set')
const models = await (await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${config.apiKey}` } })).json() as { data: { id: string; pricing: { prompt: string; completion: string; overrides?: { prompt: string; completion: string }[] } }[] }
const pricing = models.data.find(m => m.id === config.model)?.pricing
if (!pricing) throw new Error('Model price unknown: no call made')
// Worst case uses the highest rate the route can charge at any hour.
const peak = (k: 'prompt' | 'completion') => Math.max(Number(pricing[k]), ...(pricing.overrides ?? []).map(o => Number(o[k])))
const worstCase = (messages: { content: string }[]) => messages.reduce((n, m) => n + m.content.length, 0) * peak('prompt') + maxTokens * peak('completion')
let spent = 0, calls = 0
const log = join(out, 'calls.jsonl'); writeFileSync(log, '')
async function call<T>(caseId: string, run: number, messages: { role: string; content: string }[], schema: { name: string; strict: boolean; schema: unknown }) {
  const bound = worstCase(messages)
  if (spent + bound > cap) throw new Error(`Stopped before ${caseId}#${run}: spent ${spent.toFixed(5)} + worst case ${bound.toFixed(5)} > cap ${cap}`)
  calls++
  try {
    const r = await callStructured<T>(config!, messages, schema, { maxTokens })
    spent += r.costUsd ?? bound
    appendFileSync(log, JSON.stringify({ caseId, run, ok: true, costUsd: r.costUsd, countedUsd: r.costUsd ?? bound, generationId: r.generationId, promptTokens: r.promptTokens, completionTokens: r.completionTokens, raw: r.raw }) + '\n')
    return r.value
  } catch (error) {
    const known = error instanceof ModelError ? error.costUsd : null
    spent += known ?? bound // unknown outcome: count the worst case, never zero
    appendFileSync(log, JSON.stringify({ caseId, run, ok: false, costUsd: known, countedUsd: known ?? bound, error: error instanceof ModelError ? `${error.kind}: ${error.message}` : String(error), raw: error instanceof ModelError ? error.raw : null }) + '\n')
    return null
  }
}

const ctx = { capturedAt: '2026-10-19 09:00', weekday: 'Monday', timezone: 'America/Vancouver', openTasks: [
  { id: 't-tax', title: 'Tax Return', plannedOn: null, deadlineOn: null },
  { id: 't-permit', title: "Kathy's Study Permit", plannedOn: null, deadlineOn: null },
  { id: 't-appx', title: 'Rewind - APPX PR - Provider', plannedOn: null, deadlineOn: null },
] }
type Check = { type: boolean; date: boolean; title: boolean; critical: string[] }
const has = (s: string | null | undefined, ...parts: string[]) => !!s && parts.every(p => s.includes(p))
const cjk = /[一-鿿]/
const tasks = (a: CaptureAnswer) => a.items.filter((i): i is Extract<CaptureItem, { kind: 'task' }> => i.kind === 'task')
const only = <K extends CaptureItem['kind']>(a: CaptureAnswer, kind: K) => a.items.length === 1 && a.items[0]!.kind === kind ? a.items[0] as Extract<CaptureItem, { kind: K }> : null
const noTime = (a: CaptureAnswer) => a.items.every(i => i.kind !== 'event' || i.time === null)
const capture: { id: string; text: string; check: (a: CaptureAnswer) => Check }[] = [
  { id: 'C1', text: '周五前把 TFLOW PR 提了', check: a => { const t = only(a, 'task'); return { type: !!t, date: t?.date === '2026-10-23' && t.dateRole === 'due', title: has(t?.title, 'TFLOW PR') && cjk.test(t?.title ?? ''), critical: t && t.date !== '2026-10-23' ? ['wrong date'] : [] } } },
  { id: 'C2', text: 'Lunch with Kevin next Mon 12:30', check: a => { const e = only(a, 'event'); return { type: !!e, date: e?.date === '2026-10-26' && e.time === '12:30', title: has(e?.title, 'Lunch with Kevin'), critical: e && e.date !== '2026-10-26' ? ['wrong date'] : [] } } },
  { id: 'C3', text: '明天下午 Kathy 游泳课', check: a => { const e = only(a, 'event'); return { type: !!e, date: e?.date === '2026-10-20' && e.time === null, title: has(e?.title, 'Kathy', '游泳课'), critical: [...(e && e.date !== '2026-10-20' ? ['wrong date'] : []), ...(!noTime(a) ? ['invented time'] : [])] } } },
  { id: 'C4', text: 'https://github.com/karpathy/nanochat', check: a => { const m = only(a, 'material'); return { type: !!m, date: !m || m.followUpDate === null, title: m?.url === 'https://github.com/karpathy/nanochat', critical: [] } } },
  { id: 'C5', text: 'https://www.youtube.com/watch?v=abc123 这个讲 RAG 的视频周末看', check: a => { const m = only(a, 'material'); return { type: !!m, date: !m || [null, '2026-10-24', '2026-10-25'].includes(m.followUpDate), title: m?.url === 'https://www.youtube.com/watch?v=abc123' && has(m.note, 'RAG'), critical: tasks(a).length ? ['note became a task'] : [] } } },
  { id: 'C6', text: 'tax return 搞定了', check: a => { const u = only(a, 'update'); return { type: !!u && u.taskId === 't-tax', date: !u || u.newDate === null, title: !!u && u.markDone, critical: tasks(a).length ? ['duplicate task instead of update'] : [] } } },
  { id: 'C7', text: '想到一个点子：daily note 可以按 tag 自动生成周报', check: a => { const n = only(a, 'note'); return { type: !!n, date: true, title: has(n?.text, 'tag', '周报'), critical: [] } } },
  { id: 'C8', text: "下周三之前续签 Kathy's study permit，记得带护照复印件", check: a => { const u = only(a, 'update'); return { type: !!u && u.taskId === 't-permit', date: u?.newDate === '2026-10-28', title: has(u?.detail, '护照复印件'), critical: [...(tasks(a).some(t => /permit/i.test(t.title)) ? ['duplicate task instead of update'] : []), ...(u && u.newDate !== '2026-10-28' ? ['wrong date'] : [])] } } },
  { id: 'C9', text: 'Cairn cron job prod deploy 11/2', check: a => { const t = only(a, 'task'); return { type: !!t, date: t?.date === '2026-11-02', title: has(t?.title, 'Cairn cron job', 'prod deploy'), critical: t && t.date !== '2026-11-02' ? ['wrong date'] : [] } } },
  { id: 'C10', text: '月底交房租', check: a => { const t = only(a, 'task'); return { type: !!t, date: t?.date === '2026-10-31' && t.dateRole === 'due', title: has(t?.title, '交房租'), critical: t && t.date !== '2026-10-31' ? ['wrong date'] : [] } } },
  { id: 'C11', text: 'call dentist', check: a => { const t = only(a, 'task'); return { type: !!t, date: t?.date === null, title: has(t?.title?.toLowerCase(), 'call dentist'), critical: t?.date ? ['invented date'] : [] } } },
  { id: 'C12', text: '读完《Thinking in Systems》第三章', check: a => { const t = only(a, 'task'); return { type: !!t, date: t?.date === null, title: has(t?.title, '《Thinking in Systems》', '第三章'), critical: t?.date ? ['invented date'] : [] } } },
  { id: 'C13', text: 'APPX PR 改成明天再弄', check: a => { const u = only(a, 'update'); return { type: !!u && u.taskId === 't-appx', date: u?.newDate === '2026-10-20', title: !!u && !u.markDone, critical: [...(tasks(a).length ? ['duplicate task instead of update'] : []), ...(u && u.newDate !== '2026-10-20' ? ['wrong date'] : [])] } } },
  { id: 'C14', text: 'Kevin 推荐的耳机 https://www.sony.com/wh-1000xm6 双十一看看价格', check: a => { const m = only(a, 'material'); return { type: !!m, date: !m || [null, '2026-11-11'].includes(m.followUpDate), title: m?.url === 'https://www.sony.com/wh-1000xm6' && has(m.note, '双十一'), critical: [...(tasks(a).length ? ['note became a task'] : []), ...(/[$¥￥]\s?\d|\d+\s?(元|块|dollars?)/.test(JSON.stringify(a)) ? ['invented price'] : [])] } } },
  { id: 'C15', text: '今天：1. 回 Kevin 邮件 2. review APPX PR 3. 订机票', check: a => { const ts = tasks(a), u = a.items.filter(i => i.kind === 'update'); const titles = [...ts.map(t => t.title), ...u.map(x => x.kind === 'update' ? 'review APPX PR' : '')].join(' | '); const dated = [...ts.map(t => t.date), ...u.map(x => x.kind === 'update' ? x.newDate : null)]; return { type: ts.length + u.length === 3, date: dated.length === 3 && dated.every(d => d === '2026-10-19'), title: has(titles, 'Kevin', '邮件') && has(titles, 'APPX PR') && has(titles, '订机票'), critical: dated.some(d => d && d !== '2026-10-19') ? ['wrong date'] : [] } } },
]
const lines = [
  { id: 'P1', pageDate: '2026-10-16', pageWeekday: 'Fri', section: 'Notes', text: '周一给 Kevin 回电话' },
  { id: 'P2', pageDate: '2026-10-16', pageWeekday: 'Fri', section: 'Notes', text: '今天天气很好，跑了 5k' },
  { id: 'P3', pageDate: '2026-10-16', pageWeekday: 'Fri', section: 'Notes', text: '下周看看 Notion 导出的格式' },
  { id: 'P4', pageDate: '2026-10-16', pageWeekday: 'Fri', section: 'Notes', text: '如果有空可以研究一下 TRMNL 的 API' },
  { id: 'P5', pageDate: '2026-10-16', pageWeekday: 'Fri', section: 'Notes', text: '已经把 Q3 报告发出去了' },
]
const morningCheck: Record<string, (p: MorningAnswer['proposals'][number] | undefined) => Check> = {
  P1: p => ({ type: !!p?.propose, date: p?.date === '2026-10-19', title: has(p?.title, 'Kevin') && cjk.test(p?.title ?? ''), critical: p?.propose && p.date !== '2026-10-19' ? ['wrong date'] : [] }),
  P2: p => ({ type: p?.propose === false, date: true, title: true, critical: [] }),
  P3: p => ({ type: p?.propose === true, date: p?.date === null || (!!p?.date && p.date >= '2026-10-19' && p.date <= '2026-10-25'), title: !p?.propose || has(p?.title, 'Notion'), critical: p?.date === '2026-10-16' ? ['wrong date'] : [] }),
  P4: p => ({ type: !!p, date: !p?.propose || p.date === null, title: !p?.propose || has(p?.title, 'TRMNL'), critical: p?.propose && p.date ? ['dated an optional line'] : [] }),
  P5: p => ({ type: p?.propose === false, date: true, title: true, critical: [] }),
}

const results: Record<string, { checks: (Check | null)[]; outputs: string[] }> = {}
for (const c of capture) {
  results[c.id] = { checks: [], outputs: [] }
  for (let run = 1; run <= runs; run++) {
    const raw = await call<CaptureRawAnswer>(c.id, run, captureMessages(c.text, ctx), captureSchema(ctx.openTasks.map(t => t.id)))
    const a: CaptureAnswer | null = raw ? { items: captureItems(raw) } : null
    results[c.id]!.checks.push(a ? c.check(a) : null); results[c.id]!.outputs.push(a ? JSON.stringify(a.items) : '(failed)')
  }
}
for (const l of lines) results[l.id] = { checks: [], outputs: [] }
for (let run = 1; run <= runs; run++) {
  const a = await call<MorningAnswer>('P1-P5', run, morningMessages(lines, { today: '2026-10-19', weekday: 'Monday', timezone: 'America/Vancouver' }), morningSchema)
  for (const l of lines) { const p = a?.proposals.find(x => x.lineId === l.id); results[l.id]!.checks.push(a ? morningCheck[l.id]!(p) : null); results[l.id]!.outputs.push(a ? JSON.stringify(p ?? null) : '(failed)') }
}

const ok = (c: Check | null) => !!c && c.type && c.date && c.title
const rows = Object.entries(results).map(([id, r]) => {
  const good = r.checks.filter(ok).length, crit = [...new Set(r.checks.flatMap(c => c?.critical ?? []))]
  return { id, good, correct: good >= 2, flips: good > 0 && good < runs, critical: crit, outputs: r.outputs }
})
const correct = rows.filter(r => r.correct).length, criticalLines = rows.filter(r => r.critical.length).length
const summary = { model: config.model, calls, spentUsd: Number(spent.toFixed(6)), correct, of: rows.length, criticalLines, pass: correct >= 16 && criticalLines <= 1 }
writeFileSync(join(out, 'results.json'), JSON.stringify({ summary, rows }, null, 2))
console.log(JSON.stringify(summary))
for (const r of rows) console.log(`${r.id}\t${r.good}/${runs}\t${r.correct ? 'ok' : 'WRONG'}${r.flips ? ' (flips)' : ''}${r.critical.length ? `\tCRITICAL: ${r.critical.join(', ')}` : ''}`)
