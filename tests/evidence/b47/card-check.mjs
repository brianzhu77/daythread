// B47 (Lead c94fbc25, Jazz 8aebb93a): the morning after a saved review. Run against a built server, sign-in off, on a
// disposable store made from a COPY of his rev-356 workspace (tests/evidence/b47/make-store.ts), never his database:
//   DB=/tmp/rb-b47/<store>.sqlite node tests/evidence/b47/card-check.mjs <base> [width]
// No model key: Draft my day runs the card's stand-in (labelled "Simulated", as before).
import { chromium, webkit } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const [base, width = '1280'] = process.argv.slice(2), DB = process.env.DB
if (!base || new URL(base).hostname !== '127.0.0.1' || new URL(base).port === '3000' || !DB?.startsWith('/tmp/rb-b47/')) throw Error('Use a disposable loopback server and a /tmp/rb-b47/ store')
const phone = Number(width) < 600
const browser = await (phone ? webkit : chromium).launch()
const p = await browser.newPage({ viewport: { width: Number(width), height: 900 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) })
const errors = []; p.on('pageerror', e => errors.push(e.message))
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}: ${what}${detail ? ` (${detail})` : ''}`) }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const draft = () => { const d = new DatabaseSync(DB, { readOnly: true }); try { return JSON.parse(d.prepare("SELECT draft FROM pages WHERE snapshot='current' AND type='daily' AND date=?").get(today)?.draft ?? 'null') } finally { d.close() } }
const until = async (check, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await p.waitForTimeout(200)) if (await check()) return true; return Boolean(await check()) }
const card = () => p.locator('.start-the-day')
const rows = () => card().locator('.mc-row').evaluateAll(els => els.map(e => `${e.querySelector('.mc-title')?.textContent?.trim()} · ${e.querySelector('.mc-reason')?.textContent?.trim()}`))
const evening = ['#plaid_for_all_customers PRD Draft', '#daythread improvements on link as page', '#daythread bug']
const firstThree = async () => (await rows()).slice(0, 3)

await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
const before = draft()
log(before && !before.run && !before.proposals && before.taskIds.length === 3, 'his stored draft is the review\'s (no run, no proposals)')
log(await card().count() === 1, 'the card shows')
log(!(await card().locator('header .sim').count()), 'no "Simulated" on the card header')
log(!(await p.locator('.fact-block.related .sim').count()), 'no "Simulated" on Related')
const status = (await card().locator('.mc-group').first().locator('p.line').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
log(status === 'From last night · Draft my day', 'status line: "From last night · Draft my day"', status)
const r0 = await firstThree()
log(evening.every((t, i) => r0[i]?.startsWith(t) && r0[i]?.includes('Suggested last night')), 'his evening picks are the first rows, "Suggested last night"', JSON.stringify(r0))
const related0 = await p.locator('.fact-block.related .fact-row').count()
log(related0 === 2, 'Related shows his two evening links', String(related0))
await p.screenshot({ path: `/tmp/rb-b47/card-before-${width}.png`, fullPage: true })

const tap = card().getByRole('button', { name: 'Draft my day' })
phone ? await tap.tap() : await tap.click()
log(await until(() => { const d = draft(); return Boolean(d?.proposals && d?.evening) }), 'Draft my day runs over it and the draft keeps his evening picks', JSON.stringify(draft()?.evening ?? null))
await p.waitForTimeout(800)
const r1 = await firstThree()
log(evening.every((t, i) => r1[i]?.startsWith(t) && r1[i]?.includes('Suggested last night')), 'after the run his evening picks are still the first rows', JSON.stringify(r1))
const all = await rows()
log(new Set(all.map(r => r.split(' · ')[0])).size === all.length, 'no task twice', JSON.stringify(all))
log(await p.locator('.fact-block.related .fact-row').count() === 2, 'Related still shows two links (the usual limit)')
log(!(await card().getByRole('button', { name: 'Draft my day' }).count()), 'Draft my day is used: no second run offered')
await p.screenshot({ path: `/tmp/rb-b47/card-after-${width}.png`, fullPage: true })
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800)
const r2 = await firstThree()
log(evening.every((t, i) => r2[i]?.startsWith(t)), 'after a reload, the same', JSON.stringify(r2))
log(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' / '))
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
