// Typing while something that rewrites the page is on its way (Ratchet's races on Unsync, Delete and Undo, and a save that comes back conflicted).
// Unsync and Delete hold the editor as row actions do, so words either show and save, or never showed. Nothing that showed may go.
// Usage: node tests/evidence/b21/races.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, store, engine = 'chromium'] = process.argv.slice(2)
if (!base || !store) { console.error('Usage: node tests/evidence/b21/races.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const state = () => JSON.parse(execSync(`sqlite3 ${store} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const end = engine === 'webkit' ? 'End' : 'Meta+ArrowRight'
let failed = 0
const scenario = async (name, act) => {
  execSync(`rm -f ${store} ${store}-wal ${store}-shm && node --no-warnings tests/evidence/b21/seed.ts ${store}`, { stdio: 'ignore' })
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
const lines = page => page.locator('.bn-inline-content').allInnerTexts()
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const stored = id => state().pages.find(p => p.id === id).document
/** Holds the nth POST whose body matches, until `release`. */
const hold = async (page, match, nth = 1) => {
  let release, seen, count = 0
  const held = new Promise(r => { release = r }), arrived = new Promise(r => { seen = r })
  await page.route('**/_serverFn/**', async route => {
    const data = route.request().postData() ?? ''
    if (route.request().method() === 'POST' && match.test(data) && ++count === nth) { seen(); await held }
    await route.continue().catch(() => {})
  })
  return { release, arrived }
}
const openB = async page => { await page.goto(`${base}/pages?page=b`); await page.locator('.synced-label-button').first().waitFor(); await wait(1000) }
const typeBelow = async (page, text) => {
  await page.locator('.bn-inline-content', { hasText: 'Below on B' }).first().click(); await page.keyboard.press(end); await wait(180)
  await page.keyboard.type(text); await wait(700)
}
for (const action of ['Unsync here', 'Delete']) {
  await scenario(`${action}: keys during the command never show, nothing's claimed as kept, and typing after it saves`, async page => {
    await openB(page)
    const { release, arrived } = await hold(page, /unsync-block|delete-synced-place/)
    await page.locator('.bn-inline-content', { hasText: 'Shared one' }).first().hover(); await wait(200)
    await page.locator('.synced-label-button').first().click()
    await page.getByRole('menuitem', { name: action, exact: true }).click()
    await Promise.race([arrived, wait(5000).then(() => { throw new Error('no command held') })])
    await typeBelow(page, ' DURING').catch(() => {})
    const r = { during: (await lines(page)).join('|') }
    release(); await wait(2500)
    r.after = (await lines(page)).join('|'); r.notice = await notices(page)
    await typeBelow(page, ' AFTER'); await wait(1800)
    r.shown = (await lines(page)).join('|'); r.saved = stored('b').includes('AFTER')
    await page.reload(); await page.locator('.bn-inline-content').first().waitFor(); await wait(1500)
    r.reopened = (await lines(page)).join('|')
    const shownDuring = r.during.includes('DURING')
    const kept = !shownDuring || (r.shown.includes('DURING') && stored('b').includes('DURING'))
    r.ok = !/draft kept/.test(r.notice) && kept && r.saved && r.reopened.includes('AFTER') && (action === 'Delete' ? !r.after.includes('Shared one') : r.after.includes('Shared one'))
    return r
  })
}
await scenario('A save that comes back conflicted: words typed while it was on its way stay, and save', async (page, context) => {
  await openB(page)
  await page.evaluate(() => { window.BroadcastChannel = undefined })
  const other = await context.newPage()
  await other.goto(`${base}/pages?page=a`); await other.locator('.synced-label-button').first().waitFor(); await wait(1000)
  await other.locator('.bn-inline-content', { hasText: 'Shared one' }).first().click(); await other.keyboard.press(end); await wait(180)
  await other.keyboard.type(' THEIRS'); await wait(1800)
  await other.close()
  // Its first save is refused as out of date. The second, from the latest page, is the one that comes back conflicted.
  const { release, arrived } = await hold(page, /save-editor/, 2)
  await page.locator('.bn-inline-content', { hasText: /^Shared one$/ }).first().click(); await page.keyboard.press(end); await wait(180)
  await page.keyboard.type(' MINE')
  await Promise.race([arrived, wait(6000).then(() => { throw new Error('no save held') })])
  await typeBelow(page, ' WHILE')
  const r = { during: (await lines(page)).join('|') }
  release(); await wait(3500)
  r.notice = await notices(page); r.after = (await lines(page)).join('|'); r.saved = stored('b').includes('WHILE'); r.record = JSON.stringify(state().synced ?? {}).includes('THEIRS')
  await page.reload(); await page.locator('.bn-inline-content').first().waitFor(); await wait(1500)
  r.reopened = (await lines(page)).join('|')
  r.ok = r.during.includes('WHILE') && r.after.includes('WHILE') && r.saved && r.reopened.includes('WHILE') && /THEIRS/.test(r.after)
  return r
})
await scenario('Undo on "Removed from 2 pages" with the command on its way: keys never show, the line comes back, and typing after it saves', async page => {
  await openB(page)
  await page.locator('.bn-inline-content', { hasText: 'Shared two' }).first().click(); await page.keyboard.press(end)
  for (let i = 0; i < 'Shared two'.length + 1; i++) await page.keyboard.press('Backspace')
  await wait(1800)
  const r = { removed: (await lines(page)).join('|'), notice: await notices(page) }
  const { release, arrived } = await hold(page, /"undo"/)
  await page.getByRole('button', { name: 'Undo' }).last().click()
  await Promise.race([arrived, wait(5000).then(() => { throw new Error('no undo held') })])
  await typeBelow(page, ' DURING').catch(() => {})
  r.during = (await lines(page)).join('|')
  release(); await wait(2500)
  r.after = (await lines(page)).join('|'); r.noticeAfter = await notices(page)
  await typeBelow(page, ' AFTER'); await wait(1800)
  r.saved = stored('b').includes('AFTER')
  const shownDuring = r.during.includes('DURING')
  r.ok = /Removed from 2 pages/.test(r.notice) && r.after.includes('Shared two') && !/draft kept/.test(r.noticeAfter) && r.saved && (!shownDuring || stored('b').includes('DURING'))
  return r
})
await scenario('Undo while a save is on its way: the words stay gone, on the page and in the record', async page => {
  await openB(page)
  const { release, arrived } = await hold(page, /save-editor/)
  await page.locator('.bn-inline-content', { hasText: 'Shared one' }).first().click(); await page.keyboard.press(end); await wait(180)
  await page.keyboard.type(' SHOULD UNDO')
  await Promise.race([arrived, wait(6000).then(() => { throw new Error('no save held') })])
  await page.keyboard.press('Meta+z'); await wait(150)
  const r = { undone: (await lines(page)).join('|') }
  release(); await wait(3500)
  r.after = (await lines(page)).join('|'); r.notice = await notices(page); r.record = state().synced.map(s => s.lines).join().includes('SHOULD UNDO')
  await page.reload(); await page.locator('.bn-inline-content').first().waitFor(); await wait(1500)
  r.reopened = (await lines(page)).join('|')
  r.ok = !r.undone.includes('SHOULD UNDO') && !r.after.includes('SHOULD UNDO') && !r.record && !r.reopened.includes('SHOULD UNDO')
  return r
})
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
