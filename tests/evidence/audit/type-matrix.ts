// R3-16 / R4-14 audit: every property type through filter, sort, Group, calculations and a type change and back. Invented data, in memory.
import assert from 'node:assert/strict'
const R = new URL('../../../', import.meta.url).href
const { harness, today } = await import(R + 'tests/v2-helpers.ts')
const D = await import(R + 'src/domain/database.ts')
const { withLinks } = await import(R + 'src/domain/relations.ts')
const ctx = { today, pageDate: null }
const opsFor = (t: string): string[] => {
  switch (t) {
    case 'text': case 'url': case 'email': case 'phone': return ['contains', 'is', 'isEmpty', 'isNotEmpty']
    case 'number': return ['eq', 'ne', 'gt', 'lt', 'isEmpty']
    case 'id': return ['eq', 'ne', 'gt', 'lt']
    case 'createdTime': case 'editedTime': return ['is', 'before', 'after', 'within']
    case 'select': case 'status': return ['isAnyOf', 'isNoneOf', 'isEmpty']
    case 'relation': case 'multiSelect': return ['contains', 'doesNotContain', 'isEmpty']
    case 'date': return ['is', 'before', 'after', 'within', 'isEmpty']
    case 'checkbox': return ['is']
  }
  return []
}
const at = '2026-10-22T18:00:00.000Z'
const opts = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]
const defs: any[] = [
  { id: 'text', type: 'text' }, { id: 'number', type: 'number' }, { id: 'select', type: 'select', options: opts }, { id: 'multiSelect', type: 'multiSelect', options: opts },
  { id: 'status', type: 'status' }, { id: 'date', type: 'date' }, { id: 'checkbox', type: 'checkbox' }, { id: 'url', type: 'url' }, { id: 'email', type: 'email' }, { id: 'phone', type: 'phone' },
  { id: 'createdTime', type: 'createdTime' }, { id: 'editedTime', type: 'editedTime' }, { id: 'id', type: 'id', prefix: 'R' }, { id: 'relation', type: 'relation', target: 'other' },
]
const values = (n: number): any => n === 0 ? {} : {
  text: n === 1 ? 'apple' : 'pear', number: n * 10, select: n === 1 ? 'a' : 'b', multiSelect: n === 1 ? ['a'] : ['a', 'b'], date: { start: n === 1 ? '2026-10-20' : '2026-10-25' }, checkbox: n === 1,
  url: n === 1 ? 'a.com' : 'b.com', email: n === 1 ? 'a@x.com' : 'b@x.com', phone: n === 1 ? '111' : '222', relation: n === 1 ? ['o1'] : ['o1', 'o2'],
}
function build() {
  const h = harness()
  const run = h.run.bind(h)
  run({ type: 'create-database', pageId: 'other', homeBlockId: null, title: 'Other' })
  run({ type: 'add-row', databaseId: 'other', pageId: 'o1', title: 'o1', at }); run({ type: 'add-row', databaseId: 'other', pageId: 'o2', title: 'o2', at })
  run({ type: 'create-database', pageId: 'db', homeBlockId: null, title: 'All' })
  const change = (c: any) => run({ type: 'change-database', pageId: 'db', change: c })
  for (const d of defs) change({ kind: 'addProperty', property: { name: d.id, ...d } })
  change({ kind: 'addProperty', property: { id: 'rollup', name: 'rollup', type: 'rollup', rollup: { relation: 'relation', property: D.titleId ?? 'title', fn: 'countAll' } } })
  change({ kind: 'addProperty', property: { id: 'formula', name: 'formula', type: 'formula', formula: 'prop("number") + 1' } })
  for (const n of [0, 1, 2]) run({ type: 'add-row', databaseId: 'db', pageId: 'r' + n, title: 'r' + n, values: values(n), at })
  return { h, change, db: () => h.page('db').database }
}
const problems: string[] = []
const note = (s: string) => { problems.push(s); console.log('PROBLEM', s) }
const b = build()
const props = () => b.db().properties as any[]
const view = () => b.db().views[0]
const rows = (w: any, v: any) => D.viewRows(w, 'db', v, ctx).map((p: any) => p.id)
const ws = () => withLinks(b.h.ws)
console.log('types present:', props().map(p => p.type).join(' '))
const sample: any = { text: 'apple', url: 'a.com', email: 'a@x.com', phone: '111', number: 10, id: 1, select: ['a'], status: undefined, multiSelect: 'a', relation: 'o1', date: '2026-10-20', createdTime: today, editedTime: today, checkbox: true }
const table: Record<string, any> = {}
for (const p0 of props()) {
  const p = (ws().pages.find((x: any) => x.id === 'db') as any).database.properties.find((x: any) => x.id === p0.id)
  const row: any = {}
  const ops = opsFor(p.type); let okOps = 0
  for (const op of ops) {
    try { const value = p.type === 'status' ? [p.options?.[0]?.id] : sample[p.type]; const got = rows(ws(), { ...view(), filter: [{ by: p.id, op, value }] }); if (op === 'isEmpty' && p0.id !== 'id' && !['createdTime','editedTime','status','rollup','formula'].includes(p0.id) && !got.includes('r0')) note(`isEmpty on ${p0.id} misses the blank row`); okOps++ }
    catch (e: any) { note(`filter ${p0.id} ${op} threw: ${e.message}`) }
  }
  row.filter = `${okOps}/${ops.length}${p0.type !== p.type ? ' as ' + p.type : ''}`
  try { const asc = rows(ws(), { ...view(), sort: [{ by: p.id, direction: 'asc' }] }); const desc = rows(ws(), { ...view(), sort: [{ by: p.id, direction: 'desc' }] }); row.sort = asc.join('') !== desc.join('') ? 'orders' : 'same'; if (asc.length !== 3 || desc.length !== 3) note(`sort ${p0.id} lost rows`) } catch (e: any) { row.sort = 'THREW'; note(`sort ${p0.id}: ${e.message}`) }
  const db = (ws().pages.find((x: any) => x.id === 'db') as any).database
  row.group = ['table', 'list', 'board', 'gallery', 'timeline', 'calendar'].filter(l => D.groupableProperties(db, l).some((x: any) => x.id === p.id)).map(l => l[0]).join('') || '-'
  try { for (const l of ['table', 'board']) if (D.groupableProperties(db, l).some((x: any) => x.id === p.id)) { const v = { ...view(), layout: l, groupBy: p.id }; const s = D.viewSections(db, v, D.databaseRows(ws(), 'db')); if (!s) note(`no sections ${p0.id} ${l}`); else { const seen = new Set(s.shown.flatMap((g: any) => g.rows.map((r: any) => r.id))); if (seen.size !== 3) note(`group ${p0.id} ${l} shows ${seen.size} of 3 rows`) } } } catch (e: any) { note(`group ${p0.id}: ${e.message}`) }
  let okCalc = 0; const kinds = D.calcChoices(p.type)
  for (const k of kinds) try { D.columnCalc(db, D.databaseRows(ws(), 'db'), p.id, k); okCalc++ } catch (e: any) { note(`calc ${p0.id} ${k}: ${e.message}`) }
  row.calc = `${okCalc}/${kinds.length}`
  row.calendarBy = D.dateProperties(db).some((x: any) => x.id === p.id) ? 'yes' : '-'
  table[p0.id] = row
}

const expect: [string, string, any, string[]][] = [
  ['text','contains','apple',['r1']], ['text','is','pear',['r2']], ['text','isNotEmpty',undefined,['r1','r2']], ['url','contains','a.com',['r1']], ['email','contains','b@',['r2']], ['phone','is','111',['r1']],
  ['number','eq',10,['r1']], ['number','ne',10,['r0','r2']], ['number','gt',15,['r2']], ['number','lt',15,['r1']],
  ['select','isAnyOf',['a'],['r1']], ['select','isNoneOf',['a'],['r0','r2']], ['multiSelect','contains',['b'],['r2']], ['multiSelect','doesNotContain',['b'],['r0','r1']],
  ['relation','contains',['o2'],['r2']], ['relation','doesNotContain',['o2'],['r0','r1']], ['date','before',{date:'2026-10-22'},['r1']], ['date','after',{date:'2026-10-22'},['r2']], ['date','is',{date:'2026-10-25'},['r2']], ['date','isEmpty',undefined,['r0']],
  ['checkbox','is',true,['r1']], ['checkbox','is',false,['r0','r2']], ['rollup','eq',2,['r2']], ['formula','eq',11,['r1']],
]
let okMeaning = 0
for (const [by, op, value, want] of expect) {
  const got = rows(ws(), { ...view(), filter: [{ by, op, value }] }).sort()
  if (JSON.stringify(got) === JSON.stringify(want)) okMeaning++; else note(`filter meaning: ${by} ${op} ${JSON.stringify(value)} gave ${got} wanted ${want}`)
}
console.log(`filter meaning: ${okMeaning}/${expect.length}`)
const idFirst = rows(ws(), { ...view(), filter: [{ by: 'id', op: 'gt', value: 0 }] }); console.log('id gt 0 rows', idFirst.length)

// A Formula or Rollup that works out to a date, and the layouts that read a date.
{
  const c = build()
  c.change({ kind: 'addProperty', property: { id: 'fdate', name: 'fdate', type: 'formula', formula: 'prop("date")' } })
  const w = withLinks(c.h.ws); const db = (w.pages.find((x: any) => x.id === 'db') as any).database
  const f = db.properties.find((p: any) => p.id === 'fdate'), raw = c.db().properties.find((p: any) => p.id === 'fdate')
  console.log('formula date reads as', f.type, '| offered raw:', D.dateProperties(c.db()).some((p: any) => p.id === 'fdate'), '| offered read:', D.dateProperties(db).some((p: any) => p.id === 'fdate'))
}
console.table(table)

// Type changes: every storable type to every other and back.
const types = ['text','number','select','multiSelect','status','date','checkbox','url','email','phone','relation']
const to = [...types, 'createdTime','editedTime','id']
let pairs = 0, back = 0; const lost: Record<string, string[]> = {}
for (const from of types) for (const u of to) {
  if (from === u) continue
  const c = build(); pairs++
  const raw = () => JSON.stringify(['r0','r1','r2'].map(r => c.h.page(r).values?.[from]))
  const before = raw()
  const prop = (c.db().properties as any[]).find(x => x.id === from)
  const n = D.lostOnTypeChange(c.h.ws, 'db', prop, u as any)
  if (n) (lost[from] ??= []).push(`${u}:${n}`)
  try {
    c.change({ kind: 'updateProperty', propertyId: from, type: u, ...(u === 'relation' ? { target: 'other' } : {}) })
    const w = withLinks(c.h.ws)
    D.viewRows(w, 'db', { ...c.db().views[0], sort: [{ by: from, direction: 'asc' }] }, ctx)
    c.change({ kind: 'updateProperty', propertyId: from, type: from, ...(from === 'relation' ? { target: 'other' } : {}) })
    if (raw() !== before) note(`${from} -> ${u} -> ${from} changed stored values: ${before} vs ${raw()}`); else back++
  } catch (e: any) { note(`${from} -> ${u}: ${e.message}`) }
}
console.log(`type changes: ${back}/${pairs} came back unchanged`)
console.log('says lost:', JSON.stringify(lost))
console.log(problems.length ? `${problems.length} PROBLEMS` : 'NO PROBLEMS')
