// Typing while something that rewrites the page is on its way (Ratchet's races on Unsync, Delete and Undo, and a save that comes back conflicted).
// Unsync and Delete hold the editor as row actions do, and say so on screen: words either show and save, or never showed. Nothing that showed may go.
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
const wide = { width: 1280, height: 900 }, phone = { width: 390, height: 780 }
const scenario = async (name, act, viewport = wide) => {
  execSync(`rm -f ${store} ${store}-wal ${store}-shm && node --no-warnings tests/evidence/b21/seed.ts ${store}`, { stdio: 'ignore' })
  const context = await browser.newContext({ serviceWorkers: 'block', viewport }), page = await context.newPage(), errors = []
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
  await page.locator('.bn-inline-content', { hasText: /^Below/ }).first().click(); await page.keyboard.press(end); await wait(180)
  await page.keyboard.type(text); await wait(700)
}
/** While the editor's held: a real click by position, as pointer events are off, and real keys. */
const tryTyping = async (page, text) => {
  const box = await page.locator('.bn-inline-content', { hasText: 'Below on B' }).first().boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await page.keyboard.type(text); await wait(300)
}
/** Whether it's clear on screen that typing isn't being taken. */
const paused = page => page.evaluate(() => {
  const editor = document.querySelector('.continuous-editor'), body = editor?.querySelector('.bn-editor'), line = document.querySelector('.editor-save-line')
  return { dimmed: body ? Number(getComputedStyle(body).opacity) < 1 : false, says: line?.textContent ?? '', visible: line ? line.getBoundingClientRect().width > 0 : false }
})
const openSyncedMenu = async page => {
  await page.locator('.bn-inline-content', { hasText: 'Shared one' }).first().hover(); await wait(200)
  await page.locator('.synced-label-button').first().click()
}
for (const [action, word, viewport] of [['Unsync here', 'Unsyncing…', wide], ['Delete', 'Deleting…', wide], ['Unsync here', 'Unsyncing…', phone]]) {
  await scenario(`${action} at ${viewport.width}: within a second it's clear typing isn't taken, keys sent never show, and typing after it saves`, async page => {
    await openB(page)
    const { release, arrived } = await hold(page, /unsync-block|delete-synced-place/)
    await openSyncedMenu(page)
    await page.getByRole('menuitem', { name: action, exact: true }).click()
    await Promise.race([arrived, wait(5000).then(() => { throw new Error('no command held') })])
    await wait(700)
    const r = { paused: await paused(page) }
    await tryTyping(page, ' DURING')
    r.during = (await lines(page)).join('|')
    release(); await wait(2500)
    r.after = (await lines(page)).join('|'); r.notice = await notices(page); r.pausedAfter = await paused(page)
    await typeBelow(page, ' AFTER'); await wait(1800)
    r.shown = (await lines(page)).join('|'); r.saved = stored('b').includes('AFTER')
    await page.reload(); await page.locator('.bn-inline-content').first().waitFor(); await wait(1500)
    r.reopened = (await lines(page)).join('|')
    r.ok = r.paused.dimmed && r.paused.says === word && r.paused.visible && !r.during.includes('DURING') && !r.pausedAfter.dimmed && r.pausedAfter.says !== word && !/draft kept/.test(r.notice) && r.saved && r.reopened.includes('AFTER') && (action === 'Delete' ? !r.after.includes('Shared one') : r.after.includes('Shared one'))
    return r
  }, viewport)
}
await scenario('Unsync that fails: typing works again, and nothing that showed is lost', async page => {
  await openB(page)
  await typeBelow(page, ' BEFORE'); await wait(1500)
  await page.route('**/_serverFn/**', route => route.request().method() === 'POST' && /unsync-block/.test(route.request().postData() ?? '') ? route.abort() : route.continue())
  await openSyncedMenu(page)
  await page.getByRole('menuitem', { name: 'Unsync here', exact: true }).click(); await wait(2500)
  const r = { after: (await lines(page)).join('|'), paused: await paused(page), notice: await notices(page) }
  await typeBelow(page, ' AFTER'); await wait(1800)
  r.shown = (await lines(page)).join('|'); r.saved = stored('b').includes('BEFORE') && stored('b').includes('AFTER')
  r.ok = r.after.includes('BEFORE') && !r.paused.dimmed && r.shown.includes('AFTER') && r.saved
  return r
})
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
  await wait(700)
  r.paused = await paused(page)
  await tryTyping(page, ' DURING')
  r.during = (await lines(page)).join('|')
  release(); await wait(2500)
  r.after = (await lines(page)).join('|'); r.noticeAfter = await notices(page)
  await typeBelow(page, ' AFTER'); await wait(1800)
  r.saved = stored('b').includes('AFTER')
  r.ok = /Removed from 2 pages/.test(r.notice) && r.paused.dimmed && r.paused.says === 'Undoing…' && !r.during.includes('DURING') && r.after.includes('Shared two') && !/draft kept/.test(r.noticeAfter) && r.saved
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
// Two real tabs on an ordinary page: this one's save can't get through and it goes quiet, as a suspended phone tab does; the other takes its draft.
await scenario('A tab coming back after another saved its draft: the load holds typing, keys sent never show, and nothing is lost', async (page, context) => {
  await page.goto(`${base}/pages?page=plain`); await page.locator('.bn-inline-content', { hasText: 'A plain line' }).first().waitFor(); await wait(1000)
  // The load can't be told from a retry's by its request, so each is held long enough to read what the page says.
  let offline = true, holding = false, release = () => {}, seen = () => {}
  const nextLoad = () => new Promise(r => { seen = r })
  await page.route('**/_serverFn/**', async route => {
    if (offline && route.request().method() === 'POST') return route.abort()
    if (holding && route.request().method() === 'GET') { const held = new Promise(r => { release = r }); seen(); await held }
    await route.continue().catch(() => {})
  })
  await page.locator('.bn-inline-content', { hasText: 'A plain line' }).first().click(); await page.keyboard.press(end); await wait(180)
  await page.keyboard.type(' FROM THE FIRST TAB'); await wait(1500)
  // It hasn't been heard from for longer than a tab counts as gone.
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) { const raw = localStorage.getItem(key); if (raw?.includes('FROM THE FIRST TAB')) localStorage.setItem(key, JSON.stringify({ ...JSON.parse(raw), seen: Date.now() - 11 * 60_000 })) } })
  holding = true
  let load = nextLoad()
  const other = await context.newPage()
  await other.goto(`${base}/pages?page=plain`)
  const r = { status: '' }
  for (let tries = 0; tries < 8; tries++) {
    await Promise.race([load, wait(8000).then(() => { throw new Error(`no load held, last said "${r.status}"`) })])
    await wait(200)
    r.status = (await page.locator('.editor-save-line').innerText()).trim()
    if (r.status.startsWith('Loading latest…')) break
    load = nextLoad(); release()
  }
  r.otherSaved = stored('plain').includes('FROM THE FIRST TAB')
  offline = false; holding = false
  const box = await page.locator('.bn-inline-content').first().boundingBox()
  await page.mouse.click(box.x + 20, box.y + box.height / 2); await page.keyboard.type(' DURING'); await wait(300)
  r.during = (await lines(page)).join('|')
  release(); await wait(2500)
  r.after = (await lines(page)).join('|'); r.statusAfter = (await page.locator('.editor-save-line').innerText()).trim(); r.tabs = /already saved/.test(r.statusAfter)
  await other.close()
  // No click: the caret is back where it was, so the next keys land.
  await page.keyboard.type(' AFTER'); await wait(1800)
  r.saved = stored('plain')
  r.ok = r.otherSaved && r.status.startsWith('Loading latest…') && r.tabs && !r.during.includes('DURING') && r.after.includes('FROM THE FIRST TAB') && !r.after.includes('DURING') && /AFTER/.test(r.saved) && /FROM THE FIRST TAB/.test(r.saved) && (r.saved.match(/FROM THE FIRST TAB/g) ?? []).length === 1
  r.saved = r.saved.length
  return r
})
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
