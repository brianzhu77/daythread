const R = new URL('../../../', import.meta.url).href
const { harness } = await import(R + 'tests/v2-helpers.ts')
const D = await import(R + 'src/domain/database.ts')
const at = '2026-10-22T18:00:00.000Z'
const opts = [{ id: 'opt-uuid-a', name: 'Alpha' }, { id: 'opt-uuid-b', name: 'Beta' }]
const defs: any[] = [{ id: 'text', type: 'text' }, { id: 'number', type: 'number' }, { id: 'select', type: 'select', options: opts }, { id: 'multi', type: 'multiSelect', options: opts }, { id: 'date', type: 'date' }, { id: 'check', type: 'checkbox' }, { id: 'url', type: 'url' }, { id: 'rel', type: 'relation', target: 'other' }]
const vals: any = { text: 'Alpha', number: 12, select: 'opt-uuid-a', multi: ['opt-uuid-a', 'opt-uuid-b'], date: { start: '2026-10-20' }, check: true, url: 'a.com', rel: ['o1'] }
const to = ['text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'url', 'relation']
for (const d of defs) {
  const out: any = {}
  for (const u of to) {
    if (u === d.type) continue
    const h = harness(); h.run({ type: 'create-database', pageId: 'other', homeBlockId: null, title: 'O' }); h.run({ type: 'add-row', databaseId: 'other', pageId: 'o1', title: 'Row one', at })
    h.run({ type: 'create-database', pageId: 'db', homeBlockId: null, title: 'All' })
    const change = (c: any) => h.run({ type: 'change-database', pageId: 'db', change: c })
    change({ kind: 'addProperty', property: { name: d.id, ...d } })
    h.run({ type: 'add-row', databaseId: 'db', pageId: 'r', title: 'r', values: { [d.id]: vals[d.id] }, at })
    change({ kind: 'updateProperty', propertyId: d.id, type: u, ...(u === 'relation' ? { target: 'other' } : {}) })
    const p = h.page('db').database.properties.find((x: any) => x.id === d.id)
    const read = D.readValue(p, h.page('r').values?.[d.id])
    out[u] = JSON.stringify(read) + (p.options?.length ? ' opts=' + p.options.map((o: any) => o.name).join('/') : '')
  }
  console.log(d.id, out)
}
