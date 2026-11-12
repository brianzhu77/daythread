// Brian 3d7aca46: the day draft on invented days, with the real model. Every word here is made up; nothing of his is
// read or sent. Each case says which lines must come back as to-dos (first) and which must not.
//   node --env-file=<.env with OPENROUTER_API_KEY and OPENROUTER_MODEL> tests/evidence/day-draft-week/eval.ts [runs]
import { applyCommand, createEmptyWorkspace } from '../../../src/domain/workspace.ts'
import { editorSeed, inlineText, pageContentKey, textRun, type EditorNode } from '../../../src/domain/editor-document.ts'
import type { Action, Workspace } from '../../../src/domain/types.ts'
import { buildDayDraftRequest, dayDraftSchema, runDayDraft } from '../../../src/server/model/day-draft.ts'
import { callStructured, modelConfig } from '../../../src/server/model/openrouter.ts'

const config = modelConfig()
if (!config) { console.error('OPENROUTER_API_KEY and OPENROUTER_MODEL are needed.'); process.exit(2) }
const runs = Number(process.argv[2] ?? 2)
const today = '2026-11-12', yesterday = '2026-11-11'
let n = 0
const id = () => `n${++n}`
const words = (t: string) => [textRun(t)]
const h = (t: string, level = 3): EditorNode => ({ id: id(), type: 'heading', props: { level }, content: words(t), children: [] })
const quote = (t: string): EditorNode => ({ id: id(), type: 'quote', props: {}, content: words(t), children: [] })
const slot = (): EditorNode => { const i = id(); return { id: i, type: 'task', props: { taskId: `editor-task:${i}`, role: 'reference', planDate: '' }, content: [], children: [] } }
const b = (t: string, children: EditorNode[] = []): EditorNode => ({ id: id(), type: 'bulletListItem', props: {}, content: t ? words(t) : [], children })
const p = (t = ''): EditorNode => ({ id: id(), type: 'paragraph', props: {}, content: t ? words(t) : [], children: [] })
const task = (t: string, date: string): EditorNode => { const i = id(); return { id: i, type: 'task', props: { taskId: `editor-task:${i}`, role: 'plan', planDate: date }, content: words(t), children: [] } }
const divider = (): EditorNode => ({ id: id(), type: 'divider', props: {}, children: [] })

/** A day template in the shape of a real one (neutral words): planning with to-do slots, notes, reflection, a next-day list. */
const template = (next: string): EditorNode[] => [
  h('Morning Planning', 1), h('Events'), b(''), h('Top 3'), quote('Finishable today.'), slot(), slot(), slot(), h('Other'), slot(),
  divider(), h('Raw Notes', 1), p(), divider(), h('Daily Reflection', 1), h('Progress'), quote('What moved forward?'), p(), h(next), b(''),
]

function workspace(next: string) {
  let ws: Workspace = createEmptyWorkspace('UTC')
  const run = (action: Action, at?: string) => { ws = applyCommand(ws, { operationId: id(), expectedRevision: ws.revision, action: at && action.type === 'save-editor' ? { ...action, at } : action }).workspace }
  const page = (pageId: string) => ws.pages.find(x => x.id === pageId)!
  const save = (pageId: string, doc: (seed: EditorNode[]) => EditorNode[], at: string) =>
    run({ type: 'save-editor', pageId, expectedContent: pageContentKey(page(pageId)), document: JSON.stringify(doc(structuredClone(editorSeed(page(pageId), ws)))), today: at.slice(0, 10) }, at)
  run({ type: 'create-template', title: 'Day', pageId: 'tpl', dayPage: true })
  save('tpl', () => template(next), '2026-11-01T10:00:00.000Z')
  const day = (date: string) => { run({ type: 'ensure-day', date }); return `day:${date}` }
  /** Writes `lines` under the heading `title` on a day page (after its empty slot). */
  const under = (date: string, title: string, lines: EditorNode[], at: string) => save(day(date), d => {
    const i = d.findIndex(x => x.type === 'heading' && inlineText(x.content).trim() === title)
    const out = [...d]; out.splice(i + 1, out[i + 1] && !inlineText(out[i + 1]!.content).trim() && out[i + 1]!.type !== 'heading' ? 1 : 0, ...lines); return out
  }, at)
  return { run, save, day, under, get ws() { return ws }, page }
}

interface Case { name: string; next: string; build: (w: ReturnType<typeof workspace>) => void; must: string[]; mustNot: string[] }
const cases: Case[] = [
  {
    name: 'nested next-day list at the end of yesterday, with open to-dos competing', next: "Tomorrow's Todo",
    build: w => {
      w.under(yesterday, 'Top 3', [task('Draft the grant summary', yesterday), task('Renew the parking permit', yesterday)], `${yesterday}T16:00:00.000Z`)
      w.under(yesterday, 'Raw Notes', [p('Long call with the printer about the proofs; they need the files by Friday.'), p('Lunch was late.')], `${yesterday}T20:00:00.000Z`)
      w.under(yesterday, "Tomorrow's Todo", [b('Book the venue visit'), b('Website', [b('Fix the broken footer link'), b('Swap the team photo'), b('Check the contact form')])], `${yesterday}T23:30:00.000Z`)
      w.under(yesterday, 'Other', [task('Return the library books', yesterday), task('Order printer ink', yesterday)], `${yesterday}T23:35:00.000Z`)
    },
    must: ['Book the venue visit', 'Website', 'Fix the broken footer link', 'Swap the team photo', 'Check the contact form'], mustNot: [],
  },
  {
    name: 'Chinese next-day lines, one naming a time', next: '明天要做',
    build: w => {
      w.under(yesterday, 'Top 3', [task('整理报销单', yesterday)], `${yesterday}T15:00:00.000Z`)
      w.under(yesterday, '明天要做', [b('上午 10 点 给房东打电话'), b('把护照复印件发给中介'), b('买猫粮')], `${yesterday}T22:00:00.000Z`)
    },
    must: ['上午 10 点 给房东打电话', '把护照复印件发给中介', '买猫粮'], mustNot: [],
  },
  {
    name: 'an older page\'s "tomorrow" has passed; a note page names today', next: 'Next day',
    build: w => {
      w.under('2026-11-09', 'Next day', [b('Buy stamps')], '2026-11-09T22:00:00.000Z')
      w.under(yesterday, 'Raw Notes', [p('Quiet day.')], `${yesterday}T18:00:00.000Z`)
      w.run({ type: 'create-document', title: 'Studio plans', body: '', pageId: 'studio' })
      w.save('studio', d => [...d, p('Week plan'), b('Monday: clear the desk'), b('Thursday: send the invoice to Mara'), b('Friday: back up the drives')], `${yesterday}T21:00:00.000Z`)
    },
    must: ['Thursday: send the invoice to Mara'], mustNot: ['Buy stamps', 'Monday: clear the desk', 'Friday: back up the drives'],
  },
  {
    name: 'a plan at the end of a very long page', next: 'Tomorrow',
    build: w => {
      w.under(yesterday, 'Raw Notes', Array.from({ length: 220 }, (_, i) => p(`Meeting note ${i + 1}: discussed the timeline for section ${i % 9} and who owns the follow-ups.`)), `${yesterday}T19:00:00.000Z`)
      w.under(yesterday, 'Tomorrow', [b('Send the minutes to the board')], `${yesterday}T23:00:00.000Z`)
    },
    must: ['Send the minutes to the board'], mustNot: [],
  },
]

let failures = 0, cost = 0
for (const c of cases.filter(c => !process.env.CASE || c.name.includes(process.env.CASE))) {
  for (let r = 0; r < runs; r++) {
    n = 0
    const w = workspace(c.next)
    c.build(w)
    const pageId = w.day(today)
    const page = w.page(pageId)
    const run = await runDayDraft(w.ws, page, config, id, 'UTC')
    cost += run.costUsd ?? 0
    const title = (taskId: string) => w.ws.tasks.find(t => t.id === taskId)?.title ?? taskId
    const got = run.items.map(i => ({ words: i.taskId ? title(i.taskId) : inlineText(i.block!.content), kind: i.taskId ? (i.source === 'fallback' ? 'fallback' : 'to-do') : i.block!.type === 'task' ? 'new to-do' : i.block!.type }))
    const missing = c.must.filter(m => !got.some(g => g.words === m && g.kind === 'new to-do'))
    const wrong = c.mustNot.filter(m => got.some(g => g.words.includes(m)))
    const firstOther = got.findIndex(g => !c.must.includes(g.words))
    const lastMust = Math.max(-1, ...got.map((g, i) => (c.must.includes(g.words) ? i : -1)))
    const order = firstOther >= 0 && lastMust > firstOther ? 'plan lines not first' : ''
    const ok = run.status === 'ready' && !missing.length && !wrong.length
    if (!ok) failures++
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name} (run ${r + 1}): ${run.status}, ${run.ms} ms, $${run.costUsd ?? '?'}${missing.length ? ` · missing ${JSON.stringify(missing)}` : ''}${wrong.length ? ` · carried ${JSON.stringify(wrong)}` : ''}${order ? ` · ${order}` : ''}`)
    for (const g of got) console.log(`    ${g.kind}: ${g.words}`)
    // Why the model's answer was refused: these words are all invented, so its reply may be shown.
    if ((run.status === 'failed' || process.env.PROBE === 'all') && process.env.PROBE) for (let k = 0; k < 6; k++) {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, messages: buildDayDraftRequest(w.ws, page, 'UTC').messages, response_format: { type: 'json_schema', json_schema: dayDraftSchema }, provider: { require_parameters: true }, max_tokens: 8000 }) })
      const body = await res.json().catch(() => ({})) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; provider?: string; error?: { message?: string; code?: number } }
      if (!res.ok) { console.log(`    probe ${k + 1}: HTTP ${res.status} ${JSON.stringify(body.error ?? {}).slice(0, 300)}`); continue }
      const raw = body.choices?.[0]?.message?.content ?? ''
      let parsed = true; try { JSON.parse(raw) } catch { parsed = false }
      console.log(`    probe ${k + 1}: ${parsed ? 'json' : 'NOT JSON'} · finish ${body.choices?.[0]?.finish_reason} · provider ${body.provider} · ${raw.length} chars${parsed ? '' : ` · head ${JSON.stringify(raw.slice(0, 200))} · tail ${JSON.stringify(raw.slice(-200))}`}`)
    }
    if (run.status === 'failed') await callStructured(config, buildDayDraftRequest(w.ws, page, 'UTC').messages, dayDraftSchema, { maxTokens: 2500, timeoutMs: 45_000 })
      .then(r => console.log(`    (a second ask came back: ${r.raw.slice(0, 300)})`), (e: Error & { kind?: string }) => console.log(`    (the model call failed: ${e.kind ?? ''} ${e.message.slice(0, 300)})`))
  }
}
console.log(`${failures ? 'FAIL' : 'PASS'} ${failures} of ${cases.length * runs} failed · model ${config.model} · $${cost.toFixed(4)}`)
process.exit(failures ? 1 : 0)
