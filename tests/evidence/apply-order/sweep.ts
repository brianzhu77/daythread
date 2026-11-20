// B102 sweep (Lead b2b9d45d, 9401c320): every small draft at one spot, every way of tapping it, against main's live
// Apply all. Usage: node tests/evidence/apply-order/sweep.ts <reference repo> <candidate repo>
// Spots: after a heading, an empty to-do slot (fill), an anchor that is gone. Items: 2 to 4, each a new to-do (fits the
// slot), a plain line (doesn't) or an existing to-do. Taps: every ordered split into commands (each command applies
// its items, the reducer taking them in draft order). The rule: the non-empty lines he reads, in order, equal what the
// reference's Apply all leaves for the same draft. The candidate's own Apply all is checked against it too.
const [refRoot, newRoot] = process.argv.slice(2)
type Tree = { harness: any; todo: any; inlineText: (c: unknown) => string; pageNodes: (p: any) => any[] }
const load = async (root: string): Promise<Tree> => ({
  harness: (await import(`${root}/tests/v2-helpers.ts`)).harness,
  todo: (await import(`${root}/tests/v2-helpers.ts`)).todo,
  inlineText: (await import(`${root}/src/domain/editor-document.ts`)).inlineText,
  pageNodes: (await import(`${root}/src/domain/editor-document.ts`)).pageNodes,
})
const ref = await load(refRoot!), cand = await load(newRoot!)
const today = '2026-10-22', tomorrow = '2026-10-23', dayId = (d: string) => `day:${d}`
const text = (t: string) => ({ type: 'text', text: t, styles: {} })
type Kind = 'todo' | 'line' | 'existing'
type Spot = 'heading' | 'fill' | 'missing'

function build(tree: Tree, spot: Spot, kinds: Kind[]) {
  const h = tree.harness()
  h.day(today)
  const existing = kinds.flatMap((k, i) => (k === 'existing' ? [tree.todo(`e${i}`, `Existing ${i}`, 'plan', today)] : []))
  h.save(dayId(today), (d: any[]) => [...d, ...existing])
  h.day(tomorrow)
  const slot = { id: 'slot', type: 'task', props: { taskId: 'editor-task:slot' }, content: [], children: [] }
  h.save(dayId(tomorrow), () => [{ id: 'm', type: 'heading', props: { level: 2 }, content: [text('Morning')], children: [] }, ...(spot === 'fill' ? [slot] : []), { id: 'own', type: 'bulletListItem', props: {}, content: [text('Own line')], children: [] }, { id: 'r', type: 'heading', props: { level: 2 }, content: [text('Reflection')], children: [] }])
  const anchor = spot === 'heading' ? 'm' : spot === 'fill' ? 'slot' : 'gone', place = spot === 'fill' ? 'fill' : 'after'
  const items = kinds.map((k, i) => {
    const base = { id: `i${i}`, anchor, place, source: 'model', state: 'open' }
    if (k === 'existing') return { ...base, taskId: h.ws.tasks.find((t: any) => t.title === `Existing ${i}`)!.id }
    return { ...base, block: { id: `b${i}`, type: k === 'todo' ? 'task' : 'bulletListItem', props: {}, content: [text(k === 'todo' ? `New ${i}` : `Line ${i}`)], children: [] } }
  })
  h.run({ type: 'set-draft', pageId: dayId(tomorrow), status: 'ready', moreOpen: [], allowedTaskIds: items.flatMap((i: any) => (i.taskId ? [i.taskId] : [])), items })
  const apply = (ids: string[]) => h.run({ type: 'apply-draft', pageId: dayId(tomorrow), itemIds: ids, today })
  const read = () => tree.pageNodes(h.page(dayId(tomorrow))).map((n: any) => {
    const t = n.type === 'task' ? h.ws.tasks.find((x: any) => x.id === n.props?.taskId)?.title ?? tree.inlineText(n.content) : tree.inlineText(n.content)
    return String(t).trim()
  }).filter(Boolean).join(' / ')
  return { apply, read }
}

/** Every ordered split of `ids` into non-empty commands. */
function splits(ids: string[]): string[][][] {
  if (!ids.length) return [[]]
  const out: string[][][] = []
  const n = ids.length
  for (let mask = 1; mask < 1 << n; mask++) {
    const first = ids.filter((_, i) => mask & (1 << i)), rest = ids.filter((_, i) => !(mask & (1 << i)))
    for (const tail of splits(rest)) out.push([first, ...tail])
  }
  return out
}
const kindsOf = (n: number): Kind[][] => (n === 0 ? [[]] : kindsOf(n - 1).flatMap(k => (['todo', 'line', 'existing'] as Kind[]).map(x => [...k, x])))

let cases = 0, runs = 0, allMismatch = 0
const failures: string[] = []
for (const spot of ['heading', 'fill', 'missing'] as Spot[]) {
  for (const n of [2, 3, 4]) {
    for (const kinds of kindsOf(n)) {
      cases++
      const ids = kinds.map((_, i) => `i${i}`)
      const r = build(ref, spot, kinds); r.apply(ids); const expected = r.read()
      const a = build(cand, spot, kinds); a.apply(ids)
      if (a.read() !== expected) { allMismatch++; failures.push(`${spot} [${kinds.join(',')}] Apply all: ${a.read()} ≠ ${expected}`) }
      for (const seq of splits(ids)) {
        runs++
        const c = build(cand, spot, kinds)
        for (const cmd of seq) c.apply(cmd)
        const got = c.read()
        if (got !== expected) failures.push(`${spot} [${kinds.join(',')}] ${seq.map(s => s.join('+')).join(' → ')}: ${got} ≠ ${expected}`)
      }
    }
  }
}
console.log(`cases ${cases}, tap sequences ${runs}, Apply all mismatches ${allMismatch}, sequence mismatches ${failures.length - allMismatch}`)
for (const f of failures.slice(0, 30)) console.log(f)
process.exitCode = failures.length ? 1 : 0
