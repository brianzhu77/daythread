import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
// #117, trying to break it with a controlled clock. Prints what happened; it asserts nothing, so read the output. Server's TZ: America/Los_Angeles.
// Usage: node tests/evidence/review-jazz-repeat/break.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server uses)
const pw = createRequire(process.cwd() + '/package.json')('@playwright/test')
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: break.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const rows = () => store().pages.filter(p => p.parentId === 'log' && !p.trashedAt && !p.isTemplate && p.id !== 'weekly').map(p => p.id)
const seed = (start, time, nb) => execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/review-jazz-repeat/seed.ts ${S} day ${start} ${time} ${nb}`, { stdio: 'ignore' })
const browser = await pw[engine].launch({ headless: true })
const notes = p => p.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' ').slice(0, 160))
const say = (name, o) => console.log(name, JSON.stringify(o))
const session = async (now, viewport = { width: 1280, height: 800 }) => {
  const c = await browser.newContext({ viewport, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' })
  await c.clock.install({ time: new Date(now) })
  return c
}
const ms = m => m * 60_000
// 1. A tab left open across the due time, nobody touching it.
{ seed('2026-11-10', '09:00', '2026-11-09T12:00')
  const c = await session('2026-11-10T08:58:00-08:00'), p = await c.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message))
  await p.goto(`${base}/pages?page=log`); await p.waitForTimeout(2300)
  const before = rows()
  await c.clock.fastForward(ms(1)); await p.waitForTimeout(600); const at0859 = rows()
  await c.clock.fastForward(ms(3)); await p.waitForTimeout(1500); const at0903 = rows()
  await c.clock.fastForward(ms(5)); await p.waitForTimeout(800); const later = rows()
  say('1 open across due, idle', { before, at0859, at0903, later, drawn: await p.locator('tr.database-row').count(), notice: await notes(p), errs })
  await c.close() }
// 2. Typing across the due time: nothing until idle; the words and caret survive.
{ seed('2026-11-10', '09:00', '2026-11-09T12:00')
  const c = await session('2026-11-10T08:59:30-08:00'), p = await c.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message))
  await p.goto(`${base}/pages?page=notes`); await p.waitForTimeout(2300)
  await p.locator('.bn-inline-content').first().click(); await p.keyboard.type('first words')
  await p.waitForTimeout(800)
  await c.clock.fastForward(ms(1)); await p.keyboard.type(' more'); await p.waitForTimeout(500)
  const whileTyping = rows()
  await c.clock.fastForward(ms(1)); await p.keyboard.type(' again'); await p.waitForTimeout(500)
  const stillTyping = rows()
  await c.clock.fastForward(ms(3)); await p.waitForTimeout(1500)
  const afterIdle = rows()
  await p.keyboard.type(' after'); await p.waitForTimeout(1200)
  const doc = store().pages.find(x => x.id === 'notes').document
  say('2 typing across due', { whileTyping, stillTyping, afterIdle, words: (doc.match(/"text":"([^"]*)"/g) ?? []).join(' ').slice(0, 120), notice: await notes(p), errs })
  await c.close() }
// 3. Two visible tabs across the due time.
{ seed('2026-11-10', '09:00', '2026-11-09T12:00')
  const c = await session('2026-11-10T08:58:00-08:00'), a = await c.newPage(), b = await c.newPage(), errs = []; for (const p of [a, b]) p.on('pageerror', e => errs.push(e.message))
  await a.goto(`${base}/pages?page=log`); await b.goto(`${base}/pages?page=log`); await a.waitForTimeout(2300)
  await c.clock.fastForward(ms(3)); await a.waitForTimeout(2500)
  const made = rows()
  await c.clock.fastForward(ms(3)); await a.waitForTimeout(1500)
  say('3 two tabs', { made, later: rows(), a: await a.locator('tr.database-row').count(), b: await b.locator('tr.database-row').count(), noticeA: await notes(a), noticeB: await notes(b), errs })
  await c.close() }
// 4. Undo straight after the timer made a row.
{ seed('2026-11-10', '09:00', '2026-11-09T12:00')
  const c = await session('2026-11-10T08:58:00-08:00'), p = await c.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message))
  await p.goto(`${base}/pages?page=log`); await p.waitForTimeout(2300)
  await p.locator('.database-more-button').first().hover()
  // An edit of his own first, then the timer takes the Undo slot.
  await p.locator('.large-title, h1').first().click({ trial: true }).catch(() => {})
  await c.clock.fastForward(ms(3)); await p.waitForTimeout(1500)
  const made = rows()
  await p.locator('.database-th').first().click(); await p.waitForTimeout(300); await p.keyboard.press('Escape'); await p.waitForTimeout(200)
  await p.keyboard.press('Meta+z'); await p.waitForTimeout(1200)
  const undone = rows(), notice = await notes(p)
  await c.clock.fastForward(ms(3)); await p.waitForTimeout(1500)
  say('4 undo after the timer', { made, undone, notice, threeMinutesLater: rows(), last: store().pages.find(x => x.id === 'log').database.repeats?.weekly?.last, errs })
  await c.close() }
// 5. A day boundary at 390, on today's page, then three days away in the background.
{ seed('2026-11-10', '00:00', '2026-11-09T12:00')
  const c = await session('2026-11-09T23:58:30-08:00', { width: 390, height: 844 }), p = await c.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message))
  await p.goto(`${base}/`); await p.waitForTimeout(2500)
  const startUrl = p.url(), head0 = await p.locator('h1, .large-title').first().innerText().catch(() => '')
  await c.clock.fastForward(ms(1)); await p.waitForTimeout(500); const before = rows()
  await c.clock.fastForward(ms(2)); await p.waitForTimeout(2000)
  const after = rows(), url = p.url(), days = store().pages.filter(x => x.type === 'daily').map(x => x.date)
  // Away: hidden for three days, then back.
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
  await c.clock.fastForward(ms(3 * 24 * 60)); await p.waitForTimeout(800)
  const hidden = rows()
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
  await p.waitForTimeout(2000)
  say('5 day boundary at 390', { startUrl, head0, before, after, url, days, hidden, back: rows(), notice: await notes(p), overflow: await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), errs })
  await c.close() }
// 6. Offline across the due time, minute by minute, then back.
{ seed('2026-11-10', '09:00', '2026-11-09T12:00')
  const c = await session('2026-11-10T08:58:00-08:00'), p = await c.newPage(), errs = [], posts = []; p.on('pageerror', e => errs.push(e.message))
  p.on('request', r => { if (r.method() === 'POST' && (r.postData() ?? '').includes('run-repeats')) posts.push(1) })
  await p.goto(`${base}/pages?page=log`); await p.waitForTimeout(2300)
  await c.setOffline(true)
  for (let i = 0; i < 6; i++) { await c.clock.fastForward(ms(1)); await p.waitForTimeout(350) }
  const offlineRows = rows(), offlineNotice = await notes(p), tries = posts.length
  await c.setOffline(false); await p.waitForTimeout(500)
  for (let i = 0; i < 3; i++) { await c.clock.fastForward(ms(1)); await p.waitForTimeout(600) }
  await p.waitForTimeout(1200)
  say('6 offline across due', { offlineRows, offlineNotice, tries, back: rows(), notice: await notes(p), drawn: await p.locator('tr.database-row').count(), errs })
  await c.close() }
// 7. A cell half typed and left open, on the same table, when the row arrives. And a row's own page behind it.
{ seed('2026-11-10', '09:00', '2026-11-09T12:00')
  const c = await session('2026-11-10T08:50:00-08:00'), p = await c.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message))
  await p.goto(`${base}/pages?page=log`); await p.waitForTimeout(2300)
  await p.locator('.database-new').first().click(); await p.waitForTimeout(600)
  await p.keyboard.type('Mine, half typed'); await p.waitForTimeout(100)
  const focusBefore = await p.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.value ?? '').slice(0, 30))
  await c.clock.fastForward(ms(12)); await p.waitForTimeout(2000)
  const focusAfter = await p.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.value ?? '').slice(0, 30))
  await p.keyboard.type(' and done'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500)
  say('7 half typed row when it arrives', { focusBefore, focusAfter, rows: rows(), titles: store().pages.filter(x => x.parentId === 'log' && x.id !== 'weekly').map(x => x.title), notice: await notes(p), errs })
  await c.close() }
await browser.close()
