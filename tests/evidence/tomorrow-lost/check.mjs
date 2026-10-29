// Brian, Oct 29 (task #227, B68): to-dos typed under Tomorrow the evening before weren't anywhere the next morning.
// Fake clock in Vancouver, a throwaway SQLite store with sign-in off. Never point it at production: it writes.
//   saved:     on Oct 27 a control line goes to Oct 28 (left open); on Oct 28 two lines go under Tomorrow and save.
//              Oct 29: the two are to-dos on Oct 29's page; the card offers only the control, by design.
//   failed:    on Oct 29 two lines while adds fail ("Not added · Retry"). Oct 30 with adds still failing: today's block
//              shows them "From last night". With adds back: they're to-dos on Oct 30's page, off the card and the block.
//   days late: a line left on Retry on Fri Oct 30, next opened Mon Nov 2: "From Fri", then saved to Nov 2's page.
//   lost reply: the add lands (Nov 3) but its reply is lost; retries fail until two days after its day. The replay for
//              the later day is refused, the earlier add is replayed to name the task, and the task is planned for
//              today: one task, not two, found by identity even with a same-titled to-do on today.
//   unsent:    typed with no Return, then pagehide and a reload: it was added. Typed and the app killed (no event):
//              back in the input after a reload, not in the list.
//   pinyin:    leaving the input while a candidate is open adds nothing; once the candidate is confirmed it does.
// Writes are failed by refusing the add-task POST only, so day pages still open; workers are blocked so WebKit's
// requests go through page.route.
//   DAYTHREAD_STORAGE=sqlite DAYTHREAD_AUTH=off DAYTHREAD_SQLITE_PATH=/tmp/x/ws.sqlite npx vite --port 3127
//   node tests/evidence/tomorrow-lost/check.mjs http://127.0.0.1:3127
import { chromium, webkit } from '@playwright/test'

const base = (process.argv[2] ?? '').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) { console.error('usage: check.mjs http://127.0.0.1:<port> (local only: it writes)'); process.exit(2) }
const at = (date, time) => new Date(`${date}T${time}:00-07:00`)
const evening = day => at(`2026-10-${day}`, '21:00'), morning = day => at(`2026-10-${day}`, '09:00')
let failed = 0
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`) }
const flat = text => text.replace(/\n/g, ' / ')

async function openDay(page, when, path = '/') {
  await page.clock.setSystemTime(when)
  await page.goto(base + path, { waitUntil: 'networkidle' })
  // Only today's page has the Tomorrow block.
  await page.locator(path === '/' ? '.tomorrow' : '.continuous-editor').first().waitFor({ timeout: 30000 })
}
const input = page => page.getByRole('textbox', { name: 'Add a to-do for tomorrow' })
async function typeTomorrow(page, title) {
  await input(page).fill(title)
  await input(page).press('Enter')
}
const pageText = page => page.locator('.continuous-editor').first().innerText()
const cardText = page => page.locator('.start-the-day').innerText().catch(() => '')
const blockText = page => page.locator('.tomorrow').innerText()
const pendingText = page => page.locator('.tomorrow-pending').allInnerTexts().then(t => t.join(' / '))
const storedLines = page => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daythread.tomorrow-lines.')).flatMap(k => JSON.parse(localStorage.getItem(k)).map(l => l.title)))
const isAdd = route => route.request().method() === 'POST' && (route.request().postData() ?? '').includes('"add-task"')
const failAdds = page => page.route('**/_serverFn/**', route => (isAdd(route) ? route.abort() : route.continue()))
// The add reaches the server and is applied; the browser never hears back.
const loseAddReplies = page => page.route('**/_serverFn/**', async route => { if (!isAdd(route)) return route.continue(); await route.fetch(); await route.abort() })
const restoreAdds = page => page.unroute('**/_serverFn/**')
const count = (text, needle) => text.split(needle).length - 1

for (const [engine, width] of [[chromium, 1280], [webkit, 390]].filter(([e]) => !process.env.ENGINE || e.name() === process.env.ENGINE)) {
  const browser = await engine.launch()
  const tag = `${width} ${engine.name()}`, stamp = Date.now().toString(36)
  const control = `Control ${stamp} left open`, lines = [`Saved line A ${stamp}`, `Saved line B 买狗窝 ${stamp}`]
  const lost = [`Unsaved line C ${stamp}`, `Unsaved line D 买狗窝 ${stamp}`]
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Vancouver', serviceWorkers: 'block' })
  let page = await context.newPage()
  const errors = []
  // WebKit reports a request cancelled by a navigation (the save pagehide starts, cut off by the next page) as a page
  // error, "... due to access control checks". No unhandled rejection or window error is raised in the page with it.
  const cancelled = /\/_serverFn\/.* due to access control checks/
  page.on('pageerror', e => { if (!cancelled.test(e.message)) errors.push(e.message) })
  if (process.env.DEBUG_ERRORS) page.on('pageerror', e => console.log('PAGEERROR', e.stack))
  await page.clock.install({ time: evening(27) })

  // Saved: the path that works.
  await openDay(page, evening(27))
  await typeTomorrow(page, control)
  await page.locator('.tomorrow-row', { hasText: control }).waitFor({ timeout: 15000 })
  await openDay(page, evening(28))
  for (const l of lines) await typeTomorrow(page, l)
  for (const l of lines) await page.locator('.tomorrow-row', { hasText: l }).waitFor({ timeout: 15000 })
  await openDay(page, morning(29))
  const page29 = await pageText(page), card29 = await cardText(page)
  check(`${tag} saved: both lines are to-dos on Oct 29's page`, lines.every(l => page29.includes(l)), flat(page29.slice(0, 200)))
  check(`${tag} saved: the card offers the line left open on Oct 28`, card29.includes(control), flat(card29) || '(no card)')
  check(`${tag} saved: the card doesn't offer the Tomorrow lines (they're already today's)`, !lines.some(l => card29.includes(l)))

  // Failed: the same, while adds fail on Oct 29 evening (for Oct 30).
  await openDay(page, evening(29))
  await failAdds(page)
  for (const l of lost) await typeTomorrow(page, l)
  await page.locator('.tomorrow-pending', { hasText: lost[1] }).getByText('Not added').waitFor({ timeout: 15000 })
  const evening29 = await blockText(page)
  check(`${tag} failed: on the evening the block shows the lines as not added`, lost.every(l => evening29.includes(l)) && /Not added/.test(evening29), flat(evening29))
  await openDay(page, morning(30))
  await page.locator('.tomorrow-pending', { hasText: lost[1] }).getByText('Not added').waitFor({ timeout: 15000 })
  const carried30 = await pendingText(page)
  check(`${tag} failed: next morning, adds still failing, today's block shows them "From last night · Not added"`, lost.every(l => carried30.includes(l)) && count(carried30, 'From last night · Not added') === 2, carried30)
  await restoreAdds(page)
  await openDay(page, morning(30))
  await page.locator('.tomorrow-pending').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  const page30 = await pageText(page), card30 = await cardText(page), pending30 = await pendingText(page), stored30 = await storedLines(page)
  check(`${tag} failed: with adds back, the lines are to-dos on Oct 30's page`, lost.every(l => page30.includes(l)), flat(page30.slice(0, 300)))
  check(`${tag} failed: the card doesn't offer them (they're today's)`, !lost.some(l => card30.includes(l)), flat(card30))
  check(`${tag} failed: they've left the block and the device's store`, !lost.some(l => pending30.includes(l)) && stored30.length === 0, `${pending30} | ${JSON.stringify(stored30)}`)

  // Days late: left on Retry on Fri Oct 30, next opened on Mon Nov 2.
  const late = `Late line E ${stamp}`
  await openDay(page, evening(30))
  await failAdds(page)
  await typeTomorrow(page, late)
  await page.locator('.tomorrow-pending', { hasText: late }).getByText('Not added').waitFor({ timeout: 15000 })
  await openDay(page, at('2026-11-02', '09:00'))
  await page.locator('.tomorrow-pending', { hasText: late }).getByText('Not added').waitFor({ timeout: 15000 })
  const carriedNov2 = await pendingText(page)
  check(`${tag} days late: Monday's block shows it "From Fri · Not added"`, carriedNov2.includes(late) && carriedNov2.includes('From Fri · Not added'), carriedNov2)
  await restoreAdds(page)
  await openDay(page, at('2026-11-02', '09:00'))
  await page.locator('.tomorrow-pending', { hasText: late }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  const pageNov2 = await pageText(page)
  await openDay(page, at('2026-11-02', '09:00'), '/day/2026-10-31')
  const pageOct31 = await pageText(page)
  check(`${tag} days late: it's a to-do on Nov 2's page, not on Oct 31's`, pageNov2.includes(late) && !pageOct31.includes(late), flat(pageNov2.slice(0, 300)))

  // Lost reply: the add lands on Tue Nov 3 but the browser sees a failure. Its retries fail until Thu Nov 5 (two days
  // after its day). Meanwhile a second to-do with the same title is typed for Nov 5. The recovered one must be
  // found by identity, not title: on Nov 5 both are there, and the device holds nothing.
  const replied = `Lost reply F ${stamp}`
  await openDay(page, at('2026-11-02', '21:00'))
  await loseAddReplies(page)
  await typeTomorrow(page, replied)
  await page.locator('.tomorrow-pending', { hasText: replied }).getByText('Not added').waitFor({ timeout: 15000 })
  await restoreAdds(page)
  await page.route('**/_serverFn/**', route => (isAdd(route) && route.request().postData().includes('"day:2026-11-04"') ? route.abort() : route.continue()))
  await openDay(page, at('2026-11-04', '21:00'))
  await page.locator('.tomorrow-pending', { hasText: replied }).getByText('Not added').waitFor({ timeout: 15000 })
  await typeTomorrow(page, replied)
  await page.locator('.tomorrow-row', { hasText: replied }).waitFor({ timeout: 15000 })
  await restoreAdds(page)
  await openDay(page, at('2026-11-05', '09:00'))
  await page.locator('.tomorrow-pending', { hasText: replied }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1000)
  await openDay(page, at('2026-11-05', '09:00'))
  const pendingNov5 = await pendingText(page), pageNov5 = await pageText(page), storedNov5 = await storedLines(page)
  await openDay(page, at('2026-11-05', '09:00'), '/day/2026-11-03')
  const pageNov3 = await pageText(page)
  await openDay(page, at('2026-11-05', '09:00'), '/day/2026-11-04')
  const pageNov4 = await pageText(page)
  check(`${tag} lost reply: two days late, the line leaves the block and the device`, !pendingNov5.includes(replied) && !storedNov5.includes(replied), `${pendingNov5} | ${JSON.stringify(storedNov5)}`)
  check(`${tag} lost reply: Nov 5 has the recovered to-do and the same-titled one (2 rows)`, count(pageNov5, replied) === 2, `Nov 5 ×${count(pageNov5, replied)}`)
  check(`${tag} lost reply: no second copy was made (Nov 3 keeps its 1 row, Nov 4 has none)`, count(pageNov3, replied) === 1 && count(pageNov4, replied) === 0, `Nov 3 ×${count(pageNov3, replied)}, Nov 4 ×${count(pageNov4, replied)}`)

  // Unsent: typed but Return never pressed, then the app closes.
  const unsent = `Typed no Return ${stamp}`
  await openDay(page, at('2026-11-05', '21:00'))
  await input(page).fill(unsent)
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await page.locator('.tomorrow-row', { hasText: unsent }).waitFor({ timeout: 15000 }).catch(() => {})
  await openDay(page, at('2026-11-05', '21:00'))
  const blockUnsent = await blockText(page)
  check(`${tag} unsent: after pagehide and a reload it's a to-do for tomorrow`, (await page.locator('.tomorrow-row', { hasText: unsent }).count()) === 1, flat(blockUnsent))
  // Killed without any event: a navigation would fire pagehide, so a second tab opens while the first is still up.
  const killed = `Typed then killed ${stamp}`
  await input(page).fill(killed)
  const reopened = await context.newPage()
  reopened.on('pageerror', e => { if (!cancelled.test(e.message)) errors.push(e.message) })
  await openDay(reopened, at('2026-11-05', '21:00'))
  const kept = await input(reopened).inputValue(), pendingKilled = await pendingText(reopened)
  check(`${tag} unsent: killed with no event, the draft is back in the input, not in the list`, kept === killed && !pendingKilled.includes(killed), `input "${kept}"`)
  await input(reopened).fill('')
  await input(page).fill('')
  await page.close()
  page = reopened

  // Pinyin: leaving the input mid-candidate adds nothing.
  const pinyin = `买狗窝 pinyin ${stamp}`
  await input(page).focus()
  await input(page).dispatchEvent('compositionstart')
  await input(page).fill(pinyin)
  await input(page).blur()
  await page.waitForTimeout(500)
  const midBlock = await blockText(page), midValue = await input(page).inputValue()
  check(`${tag} pinyin: leaving mid-candidate adds nothing and keeps the text`, !midBlock.includes(pinyin) && midValue === pinyin, flat(midBlock))
  await input(page).dispatchEvent('compositionend')
  await page.waitForTimeout(50)
  await input(page).focus()
  await input(page).blur()
  await page.locator('.tomorrow-row', { hasText: pinyin }).waitFor({ timeout: 15000 }).catch(() => {})
  check(`${tag} pinyin: once confirmed, leaving the input adds it`, (await page.locator('.tomorrow-row', { hasText: pinyin }).count()) === 1)

  check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '))
  await context.close()
  await browser.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
