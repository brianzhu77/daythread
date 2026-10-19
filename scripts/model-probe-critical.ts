// Re-score critical errors per call under the frozen rule (any single run counts).
import { readFileSync } from 'node:fs'
import { captureItems, type CaptureItem } from '../src/server/model/capture-prompt.ts'
const inputs: Record<string, string> = { C1: '周五前把 TFLOW PR 提了', C2: 'Lunch with Kevin next Mon 12:30', C3: '明天下午 Kathy 游泳课', C4: 'https://github.com/karpathy/nanochat', C5: 'https://www.youtube.com/watch?v=abc123 这个讲 RAG 的视频周末看', C6: 'tax return 搞定了', C7: '想到一个点子：daily note 可以按 tag 自动生成周报', C8: "下周三之前续签 Kathy's study permit，记得带护照复印件", C9: 'Cairn cron job prod deploy 11/2', C10: '月底交房租', C11: 'call dentist', C12: '读完《Thinking in Systems》第三章', C13: 'APPX PR 改成明天再弄', C14: 'Kevin 推荐的耳机 https://www.sony.com/wh-1000xm6 双十一看看价格', C15: '今天：1. 回 Kevin 邮件 2. review APPX PR 3. 订机票' }
// Critical 1: dated cases and the date(s) any dated item must carry.
const dates: Record<string, string[]> = { C1: ['2026-10-23'], C2: ['2026-10-26'], C3: ['2026-10-20'], C8: ['2026-10-28'], C9: ['2026-11-02'], C10: ['2026-10-31'], C13: ['2026-10-20'], C15: ['2026-10-19'] }
const tok = (t: string) => new Set([...(t.toLowerCase().match(/[a-z0-9][a-z0-9'’-]+/g) ?? []), ...(t.match(/[㐀-鿿]/g) ?? [])])
const fromInput = (s: string, input: string) => { const own = [...tok(s)], inp = tok(input); return own.length > 0 && own.some(t => inp.has(t)) }
const cjk = /[㐀-鿿]/
function critical(id: string, items: CaptureItem[]): string[] {
  const input = inputs[id]!, out: string[] = []
  const itemDate = (i: CaptureItem) => i.kind === 'task' || i.kind === 'event' ? i.date : i.kind === 'update' ? i.newDate : null
  if (dates[id]) {
    const relevant = items.filter(i => i.kind !== 'note' && i.kind !== 'material')
    if (!relevant.length) out.push('1 date lost (no dated item)')
    for (const i of relevant) if (itemDate(i) !== dates[id]![0]) out.push(`1 wrong/lost date ${itemDate(i)}`)
  }
  for (const i of items) {
    const title = i.kind === 'task' || i.kind === 'event' ? i.title : i.kind === 'note' ? i.text : null
    if (title && !fromInput(title, input)) out.push(`2 invented title "${title}"`)
    if (i.kind === 'event' && i.time && !input.includes(i.time)) out.push(`2 invented time ${i.time}`)
    if (i.kind === 'material' && (!/^https?:\/\//.test(i.url) || !input.includes(i.url))) out.push(`2 invented URL ${i.url}`)
    if (title && cjk.test(input) && !cjk.test(title) && /[a-z]{4}/i.test(title) && !fromInput(title, input)) out.push('4 translated')
  }
  // Critical 3: an existing task named in the text but a duplicate task created, or an update aimed at the wrong task.
  const ref: Record<string, string> = { C6: 't-tax', C8: 't-permit', C13: 't-appx' }
  if (ref[id] && items.some(i => i.kind === 'task')) out.push('3 duplicate instead of reference')
  for (const i of items) if (i.kind === 'update' && !['C6', 'C8', 'C13', 'C15'].includes(id)) out.push(`3 update to unnamed task ${i.taskId}`)
  return out
}
for (const run of process.argv.slice(2)) {
  const calls = readFileSync(new URL(`../docs/validation/evidence/model-probe-2026-10-19/${run}/calls.jsonl`, import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  let total = 0
  for (const c of calls.filter(c => c.ok && c.caseId.startsWith('C'))) {
    const crit = critical(c.caseId, captureItems(JSON.parse(c.raw)))
    if (crit.length) { total += crit.length; console.log(`  ${run} ${c.caseId}#${c.run}: ${crit.join('; ')}`) }
  }
  // Morning P1 dated item; P3/P4 must not be dated before today / at all.
  for (const c of calls.filter(c => c.ok && c.caseId === 'P1-P5')) {
    const ps = JSON.parse(c.raw).proposals as { lineId: string; propose: boolean; date: string | null }[]
    const p1 = ps.find(p => p.lineId === 'P1'); if (p1?.propose && p1.date !== '2026-10-19') { total++; console.log(`  ${run} P1#${c.run}: 1 wrong date ${p1.date}`) }
    const p4 = ps.find(p => p.lineId === 'P4'); if (p4?.propose && p4.date) { total++; console.log(`  ${run} P4#${c.run}: dated optional line`) }
  }
  console.log(`${run}: ${total} critical errors (calls that failed outright not counted here)`)
}
