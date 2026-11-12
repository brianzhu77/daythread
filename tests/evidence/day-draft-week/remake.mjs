// Brian 3d7aca46, on the store seed.ts made (invented words), served with the model on: today's page, whose draft an
// older build made, asks once, keeps the to-do he applied from it, and shows yesterday's next-day lines as to-dos;
// a reload asks nothing more.
//   node tests/evidence/day-draft-week/remake.mjs <base> <server log> <chromium|webkit> [shots dir]
// Asks are counted in the server's log (its `draft.prepare` lines carry counts only).
import { readFileSync } from 'node:fs'
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const [base, log, engine = 'chromium', shots] = process.argv.slice(2)
const prepared = () => readFileSync(log, 'utf8').split('\n').filter(l => l.includes('"event":"draft.prepare"')).map(l => JSON.parse(l.slice(l.indexOf('{'))))
const before = prepared().length
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const b = await (engine === 'webkit' ? webkit : chromium).launch()
const c = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, timezoneId: 'America/Vancouver' })
const p = await c.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message))
const asks = () => prepared().slice(before)
const open = async () => { await p.goto(base + '/'); await p.locator('.continuous-editor').first().waitFor({ timeout: 30000 }) }
const bands = () => p.locator('.draft-band').allTextContents().then(t => t.map(s => s.replace(/\s+/g, ' ').trim()))
const lines = ['Book the venue visit', 'Fix the broken footer link', 'Swap the team photo']

await open()
const started = Date.now()
let shown = []
while (Date.now() - started < 60_000) { shown = await bands(); if (lines.every(l => shown.some(s => s.includes(l)))) break; await p.waitForTimeout(500) }
ok(lines.every(l => shown.some(s => s.includes(l))), `the next-day lines are offered (${((Date.now() - started) / 1000).toFixed(1)} s): ${JSON.stringify(shown)}`)
ok(asks().length === 1 && asks()[0].remade === true && asks()[0].status === 'ready', `one ask, made again (${JSON.stringify(asks().map(a => [a.remade, a.status, a.items]))})`)
const permit = await p.locator('.editor-task-title', { hasText: 'Renew the parking permit' }).count()
ok(permit === 1, `the to-do applied from the older draft is on the page once (${permit})`)
ok(!shown.some(s => s.includes('Renew the parking permit')), 'and not offered again')
if (shots) await p.screenshot({ path: `${shots}/remake-${engine}.png` })
await p.reload(); await p.locator('.continuous-editor').first().waitFor({ timeout: 30000 }); await p.waitForTimeout(4000)
ok(asks().length === 1, `a reload asks nothing more (${asks().length} in all)`)
const again = await bands()
ok(lines.every(l => again.some(s => s.includes(l))), 'the new draft is the one stored')
ok(errors.length === 0, `no page errors ${JSON.stringify(errors.slice(0, 2))}`)
await b.close()
console.log(fail ? `FAIL ${fail}` : 'ALL PASS')
process.exit(fail ? 1 : 0)
