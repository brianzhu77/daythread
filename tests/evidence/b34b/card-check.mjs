// B34b (Jazz rule 3): the morning card shows yesterday's tree, and what he adds lands nested, whatever order he taps.
// Built server, sign-in off, a store from seed.ts:
//   DB=<store> node tests/evidence/b34b/card-check.mjs <base> [width] [mode: taps|all]
import { chromium, webkit } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const [base, width = '1280', mode = 'taps'] = process.argv.slice(2), DB = process.env.DB
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || new URL(base).port === '3000' || !DB?.startsWith('/tmp/rb-b34b-')) throw Error('Use a disposable loopback server and a seeded /tmp/rb-b34b-* store')
const phone = Number(width) < 600
const browser = await (phone ? webkit : chromium).launch()
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 1000 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) })
const p = await ctx.newPage(), errors = []
p.on('pageerror', e => errors.push(e.message))
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}: ${what}${detail ? ` (${detail})` : ''}`) }
await p.goto(base + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
const card = await p.locator('.mc-list li.mc-row').evaluateAll(rows => rows.map(r => [r.querySelector('.mc-title')?.textContent?.trim(), parseFloat(getComputedStyle(r).marginLeft) || 0]))
log(JSON.stringify(card.map(([t]) => t)) === JSON.stringify(['A', 'B', 'b1', 'b1x', 'C', 'D']), 'the card lists the tree in page order', JSON.stringify(card.map(([t]) => t)))
log(JSON.stringify(card.map(([, m]) => m)) === JSON.stringify([0, 0, 24, 48, 0, 0]), 'sub-tasks are indented one step per level', JSON.stringify(card.map(([, m]) => m)))
await p.screenshot({ path: `/tmp/rb-b34b-card-${width}.png`, fullPage: false })
if (mode === 'all') await p.getByRole('button', { name: /^Add all/ }).click()
else for (const t of ['b1x', 'B', 'A', 'b1', 'C', 'D']) {
  await p.getByRole('button', { name: new RegExp(`^Add ${t} to`) }).click(); await p.waitForTimeout(700)
  if (t === 'B') {
    const left = await p.locator('.mc-list li.mc-strip').evaluateAll(rows => rows.map(r => parseFloat(getComputedStyle(r).marginLeft) || 0))
    log(left.includes(48), 'an added sub-task\'s strip keeps its indent', JSON.stringify(left))
  }
}
await p.waitForTimeout(1500)
// Taps land top-level rows in tap order (B34a); Add all in card order. Sub-tasks always under their parent.
const expected = mode === 'all' ? ['A', 'B', '  b1', '    b1x', 'C', 'D'] : ['B', '  b1', '    b1x', 'A', 'C', 'D']
const db = new DatabaseSync(DB, { readOnly: true })
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const row = db.prepare("SELECT sections FROM pages WHERE snapshot='current' AND type='daily' AND date=?").get(today); db.close()
const sections = JSON.parse(String(row?.sections ?? '[]')), rows = k => sections.filter(s => s.kind === k).flatMap(s => s.blocks).filter(b => b.kind === 'task').map(b => b.text)
const top = expected.filter(l => l !== 'D').map(l => l.trim())
log(JSON.stringify(rows('top3')) === JSON.stringify(top) && JSON.stringify(rows('other')) === JSON.stringify(['D']), 'Top 3 holds A, B and C with B\'s sub-tasks (no slot); D stays in Other', `${JSON.stringify(rows('top3'))} ${JSON.stringify(rows('other'))}`)
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
const tree = await p.locator('.continuous-editor [data-content-type="task"]').evaluateAll(rows => rows.map(r => {
  let depth = -1
  for (let g = r.closest('.bn-block-group'); g; g = g.parentElement?.closest('.bn-block-group')) depth++
  return '  '.repeat(depth) + (r.querySelector('.bn-inline-content')?.textContent ?? '').trim()
}).filter(l => l.trim()))
log(JSON.stringify(tree) === JSON.stringify(expected), `${mode}: today's page shows the same tree after a reload`, JSON.stringify(tree))
await p.screenshot({ path: `/tmp/rb-b34b-today-${width}-${mode}.png`, fullPage: false })
log(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' / '))
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
