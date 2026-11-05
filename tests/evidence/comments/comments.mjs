// Comments on a page or row with the pane, in the built app (comments.md step 1).
// Usage: node tests/evidence/comments/comments.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/comments/comments.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const threads = () => store().threads ?? []
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const big = { viewport: { width: 1280, height: 800 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
const send = engine === 'webkit' ? 'Meta+Enter' : 'Control+Enter'
let failed = 0
const scenario = async (name, act, options = big, path = '/pages?page=notes') => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/comments/seed.ts ${S}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}${path}`); await wait(1800); r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 2).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 640))
  await context.close()
}
const pane = page => page.locator('.comments-pane')
const fromMenu = async (page, label = 'Page actions') => { await page.getByRole('button', { name: label }).first().click(); await page.getByRole('menuitem', { name: 'Comment', exact: true }).click(); await wait(250) }
const field = page => page.getByRole('textbox', { name: 'New comment' })
const addComment = async (page, words) => { await field(page).fill(words); await field(page).press(send); await wait(500) }
const texts = page => pane(page).locator('.comment-body').allTextContents()

await scenario('nothing shows on a page until there is a comment, then a count opens the pane; add, reply and edit write nothing to the page', async page => {
  const before = store().pages.find(p => p.id === 'notes')
  const none = await page.locator('.comment-count').count()
  await fromMenu(page)
  const focused = await field(page).evaluate(n => n === document.activeElement)
  const side = await pane(page).boundingBox()
  await addComment(page, 'First note')
  const added = threads().length === 1 && threads()[0].comments[0].body === 'First note', cleared = await field(page).inputValue() === ''
  const noNotice = await page.getByText('Comment added').count() === 0
  await pane(page).getByRole('button', { name: 'Reply', exact: true }).click()
  await page.getByRole('textbox', { name: 'Reply' }).fill('A reply')
  await page.getByRole('textbox', { name: 'Reply' }).press(send); await wait(500)
  await pane(page).getByRole('button', { name: 'Edit' }).first().click()
  await page.getByRole('textbox', { name: 'Edit comment' }).fill('First note, changed')
  await page.getByRole('textbox', { name: 'Edit comment' }).press(send); await wait(500)
  const edited = (await pane(page).locator('time').first().textContent()).includes('edited')
  const after = store().pages.find(p => p.id === 'notes')
  await pane(page).getByRole('button', { name: 'Close comments' }).click(); await wait(200)
  const count = await page.locator('.comment-count').textContent()
  await page.locator('.comment-count').click(); await wait(250)
  const shown = await texts(page)
  return { ok: none === 0 && focused && side.width === 360 && side.x + side.width === 1280 && added && cleared && noNotice && edited && after.document === before.document && count === '1' && shown.join() === 'First note, changed,A reply', none, focused, side, added, cleared, noNotice, edited, count, shown }
})
await scenario('a row page offers it too, and its count is on the row', async page => {
  await fromMenu(page, 'Row actions')
  await addComment(page, 'On a row')
  const t = threads()[0]
  await page.reload(); await wait(1800)
  const count = await page.locator('.comment-count').textContent()
  return { ok: t.pageId === 'one' && count === '1', on: t.pageId, count }
}, big, '/pages?page=one')
await scenario('a day: from its menu, in the day\'s head', async page => {
  await fromMenu(page, 'Day actions')
  await addComment(page, 'On the day')
  const t = threads()[0], day = store().pages.find(p => p.id === t.pageId)
  return { ok: Boolean(day.date) && await page.locator('.comment-count').textContent() === '1', day: day.date }
}, big, '/')
await scenario('resolve moves it to Resolved with an Undo, the count drops, and it reopens; delete has an Undo that brings it back', async page => {
  await fromMenu(page); await addComment(page, 'A note')
  await pane(page).getByRole('button', { name: 'Resolve' }).click(); await wait(500)
  const empty = await pane(page).locator('.comment-note').textContent(), gone = await page.locator('.comment-count').count()
  await page.getByRole('button', { name: 'Undo' }).click(); await wait(600)
  const undone = !threads()[0].resolvedAt && await texts(page)
  await pane(page).getByRole('button', { name: 'Resolve' }).click(); await wait(500)
  await pane(page).getByRole('tab', { name: 'Resolved' }).click(); await wait(100)
  const inResolved = await texts(page), noField = await field(page).count()
  await pane(page).getByRole('button', { name: 'Reopen' }).click(); await wait(500)
  const reopened = !threads()[0].resolvedAt
  await pane(page).getByRole('tab', { name: 'Open' }).click(); await wait(100)
  await pane(page).getByRole('button', { name: 'Delete' }).click(); await wait(500)
  const deleted = threads().length === 0
  await page.getByRole('button', { name: 'Undo' }).last().click(); await wait(600)
  const back = await texts(page)
  return { ok: empty === 'No open comments · 1 resolved' && gone === 0 && undone?.[0] === 'A note' && inResolved[0] === 'A note' && noField === 0 && reopened && deleted && back[0] === 'A note', empty, gone, undone, inResolved, noField, reopened, deleted, back }
})
await scenario('a newer reply takes the Undo away here; in a tab that hadn\'t heard of it, Undo reads Can\'t undo and the reply stands', async (page, context) => {
  await fromMenu(page); await addComment(page, 'A note')
  await pane(page).getByRole('button', { name: 'Resolve' }).click(); await wait(500)
  const shown = await page.getByRole('button', { name: 'Undo' }).count()
  await pane(page).getByRole('tab', { name: 'Resolved' }).click(); await wait(100)
  await pane(page).getByRole('button', { name: 'Reply', exact: true }).click()
  await page.getByRole('textbox', { name: 'Reply' }).fill('Reply here'); await page.getByRole('textbox', { name: 'Reply' }).press(send); await wait(600)
  const retired = await page.getByRole('button', { name: 'Undo' }).count()
  // Resolved again here, with its Undo showing, then a reply from another tab that this one hasn't heard of.
  await pane(page).getByRole('button', { name: 'Reopen' }).click(); await wait(500)
  const other = await context.newPage(); await other.goto(`${base}/pages?page=notes`); await wait(1800)
  await other.locator('.comment-count').click(); await wait(250)
  await pane(other).getByRole('button', { name: 'Reply', exact: true }).click()
  await other.getByRole('textbox', { name: 'Reply' }).fill('Newer reply'); await other.getByRole('textbox', { name: 'Reply' }).press(send); await wait(600)
  await page.bringToFront()
  const undo = page.getByRole('button', { name: 'Undo' }), had = await undo.count()
  if (had) { await undo.first().click(); await wait(800) }
  const said = await page.getByText("Can't undo · edited since").count(), t = threads()[0]
  return { ok: shown === 1 && retired === 0 && had === 1 && said === 1 && t.comments.map(c => c.body).join() === 'A note,Reply here,Newer reply' && !t.resolvedAt, shown, retired, had, said, comments: t.comments.map(c => c.body), resolved: Boolean(t.resolvedAt) }
})
await scenario('two tabs: the one that hadn\'t seen a change to this thread is refused with its words kept, and the change stands', async (page, context) => {
  await fromMenu(page); await addComment(page, 'A note')
  const other = await context.newPage(); await other.goto(`${base}/pages?page=notes`); await wait(1800)
  await other.locator('.comment-count').click(); await wait(250)
  await pane(other).getByRole('button', { name: 'Edit' }).click(); await other.getByRole('textbox', { name: 'Edit comment' }).fill('Old view')
  await page.bringToFront()
  await pane(page).getByRole('button', { name: 'Reply', exact: true }).click()
  await page.getByRole('textbox', { name: 'Reply' }).fill('Newer reply'); await page.getByRole('textbox', { name: 'Reply' }).press(send); await wait(500)
  await other.bringToFront()
  await other.getByRole('textbox', { name: 'Edit comment' }).press(send); await wait(900)
  const toast = await other.getByText('Changed in another tab, so nothing was changed').count(), kept = await other.getByRole('textbox', { name: 'Edit comment' }).inputValue(), noRetry = await pane(other).getByRole('button', { name: 'Retry' }).count()
  const t = threads()[0]
  // Sent again it's refused again, as the thread is still not what was being edited.
  await other.getByRole('textbox', { name: 'Edit comment' }).press(send); await wait(900)
  const still = threads()[0].comments[0].body
  return { ok: toast === 1 && kept === 'Old view' && noRetry === 0 && t.comments[0].body === 'A note' && t.comments.length === 2 && still === 'A note', toast, kept, noRetry, comments: t.comments.map(c => c.body), still }
})
await scenario('two tabs: a change to another page gets in nobody\'s way, for an edit, a new comment or a resolve', async (page, context) => {
  await fromMenu(page); await addComment(page, 'A note')
  const other = await context.newPage(); await other.goto(`${base}/pages?page=notes`); await wait(1800)
  await other.locator('.comment-count').click(); await wait(250)
  const elsewhere = async () => { execSync(`node --no-warnings --input-type=module -e "import('${process.cwd()}/src/server/sqlite-repository.ts').then(async ({SqliteWorkspaceRepository:R})=>{const r=new R('${S}',undefined,{allowMissingLegacy:true});const w=await r.load();await r.execute({operationId:crypto.randomUUID(),expectedRevision:w.revision,action:{type:'create-document',title:'Elsewhere '+w.revision,body:''}})})"`, { stdio: 'ignore' }) }
  await elsewhere()
  await pane(other).getByRole('button', { name: 'Edit' }).click(); await other.getByRole('textbox', { name: 'Edit comment' }).fill('Edited here')
  await other.getByRole('textbox', { name: 'Edit comment' }).press(send); await wait(900)
  const edited = threads()[0].comments[0].body
  await elsewhere()
  await addComment(other, 'A second thread')
  await elsewhere()
  await pane(other).getByRole('button', { name: 'Resolve' }).first().click(); await wait(900)
  const all = threads(), refused = await other.getByText('Changed in another tab').count(), failed = await pane(other).getByText('Not saved').count()
  return { ok: edited === 'Edited here' && all.length === 2 && all.filter(t => t.resolvedAt).length === 1 && refused === 0 && failed === 0, edited, threads: all.length, resolved: all.filter(t => t.resolvedAt).length, refused, failed }
})
await scenario('a failed save keeps the words with Retry; a save whose answer was lost isn\'t made twice', async page => {
  await fromMenu(page)
  await page.route('**/_serverFn/**', r => r.request().method() === 'POST' ? r.abort() : r.continue())
  await field(page).fill('Through a dead line'); await field(page).press(send); await wait(900)
  const kept = await field(page).inputValue(), said = await pane(page).getByText('Not saved').count(), none = threads().length
  await page.unroute('**/_serverFn/**')
  // Now the save lands and its answer is lost.
  await page.route('**/_serverFn/**', async r => { if (r.request().method() !== 'POST' || !decodeURIComponent(r.request().postData() ?? '').includes('add-comment')) return r.continue(); await r.fetch(); await r.abort() })
  await pane(page).getByRole('button', { name: 'Retry' }).click(); await wait(900)
  const landed = threads().length, stillSaid = await pane(page).getByText('Not saved').count()
  await page.unroute('**/_serverFn/**')
  await pane(page).getByRole('button', { name: 'Retry' }).click(); await wait(900)
  const once = threads().length, comments = threads()[0].comments.length, cleared = await field(page).inputValue()
  return { ok: kept === 'Through a dead line' && said === 1 && none === 0 && landed === 1 && stillSaid === 1 && once === 1 && comments === 1 && cleared === '', kept, said, none, landed, stillSaid, once, comments, cleared }
})
await scenario('over 2,000 says so and won\'t send, with the words kept; at 2,000 it saves', async page => {
  await fromMenu(page)
  await field(page).fill('x'.repeat(2001)); await field(page).press(send); await wait(400)
  const said = await pane(page).getByText('2,000 characters at most').count(), off = await pane(page).getByRole('button', { name: 'Comment', exact: true }).isDisabled(), none = threads().length, kept = (await field(page).inputValue()).length
  await field(page).fill('x'.repeat(2000)); await field(page).press(send); await wait(500)
  return { ok: said === 1 && off && none === 0 && kept === 2001 && threads()[0].comments[0].body.length === 2000, said, off, none, kept }
})
await scenario('Esc keeps the words, in a field and across closing the pane, and closes it from outside the field', async page => {
  await fromMenu(page)
  await field(page).fill('Half a thought')
  await page.keyboard.press('Escape'); await wait(150)
  const open = await pane(page).count(), left = await field(page).evaluate(n => n !== document.activeElement)
  await page.keyboard.press('Escape'); await wait(150)
  const closed = await pane(page).count()
  await fromMenu(page)
  const back = await field(page).inputValue()
  return { ok: open === 1 && left && closed === 0 && back === 'Half a thought' && threads().length === 0, open, left, closed, back }
})
await scenario('a draft survives a reload, and is gone once it\'s sent or cancelled; a reply\'s too', async page => {
  await fromMenu(page)
  await field(page).fill('Half a thought'); await wait(100)
  await page.reload(); await wait(1800)
  await fromMenu(page)
  const back = await field(page).inputValue()
  await field(page).press(send); await wait(500)
  await page.reload(); await wait(1800)
  await page.locator('.comment-count').click(); await wait(250)
  const sent = await field(page).inputValue()
  await pane(page).getByRole('button', { name: 'Reply', exact: true }).click()
  await page.getByRole('textbox', { name: 'Reply' }).fill('A reply half written'); await wait(100)
  await page.reload(); await wait(1800)
  await page.locator('.comment-count').click(); await wait(250)
  await pane(page).getByRole('button', { name: 'Reply', exact: true }).click()
  const reply = await page.getByRole('textbox', { name: 'Reply' }).inputValue()
  await pane(page).getByRole('button', { name: 'Cancel' }).click(); await wait(100)
  await pane(page).getByRole('button', { name: 'Reply', exact: true }).click()
  const cancelled = await page.getByRole('textbox', { name: 'Reply' }).inputValue()
  return { ok: back === 'Half a thought' && sent === '' && reply === 'A reply half written' && cancelled === '', back, sent, reply, cancelled }
})
await scenario('a comment leaves the notice\'s Undo of what came before, and that Undo leaves the comment', async page => {
  await page.getByRole('button', { name: 'Page actions' }).first().click(); await page.getByRole('menuitem', { name: 'Delete' }).click(); await wait(500)
  const trashed = Boolean(store().pages.find(p => p.id === 'other').trashedAt)
  await page.locator('.tree-title', { hasText: 'Notes' }).first().click(); await wait(500)
  await fromMenu(page); await addComment(page, 'Jotted after')
  const undo = page.getByRole('button', { name: 'Undo' }), shown = await undo.count()
  if (shown) { await undo.first().click(); await wait(700) }
  const back = !store().pages.find(p => p.id === 'other').trashedAt, note = threads()[0]?.comments[0]?.body
  return { ok: trashed && shown === 1 && back && note === 'Jotted after', trashed, shown, back, note }
}, big, '/pages?page=other')
await scenario('going to another page closes the pane, so nothing is written to a page out of sight', async page => {
  await fromMenu(page)
  await page.goto(`${base}/pages?page=notes`); await wait(1500)
  await fromMenu(page)
  await page.evaluate(() => { history.pushState({}, '', '/pages?page=other'); dispatchEvent(new PopStateEvent('popstate')) }); await wait(700)
  return { ok: await pane(page).count() === 0 && (await page.title()).length >= 0, open: await pane(page).count() }
})
await scenario('search finds a comment\'s words and opens its thread, resolved ones under Resolved', async page => {
  await fromMenu(page); await addComment(page, 'Findable words')
  await pane(page).getByRole('button', { name: 'Resolve' }).click(); await wait(400)
  await pane(page).getByRole('button', { name: 'Close comments' }).click()
  await page.goto(`${base}/pages?page=other`); await wait(1500)
  await page.keyboard.press(engine === 'webkit' ? 'Meta+k' : 'Control+k'); await wait(300)
  await page.keyboard.type('findable', { delay: 15 }); await wait(500)
  const group = await page.getByText('Comments', { exact: true }).count()
  await page.keyboard.press('Enter'); await wait(1000)
  const at = new URL(page.url()).search, tab = await pane(page).getByRole('tab', { name: 'Resolved' }).getAttribute('aria-selected'), shown = await texts(page), focused = await pane(page).locator('.comment-thread.is-focused').count()
  return { ok: group === 1 && at.includes('notes') && tab === 'true' && shown[0] === 'Findable words' && focused === 1, group, at, tab, shown, focused }
})
await scenario('a trashed page takes them along and restoring brings them back', async page => {
  await fromMenu(page); await addComment(page, 'Goes with it')
  await pane(page).getByRole('button', { name: 'Close comments' }).click()
  await page.getByRole('button', { name: 'Page actions' }).first().click(); await page.getByRole('menuitem', { name: 'Delete' }).click(); await wait(700)
  const waits = threads().length, trashed = Boolean(store().pages.find(p => p.id === 'notes').trashedAt), closed = await pane(page).count()
  await page.getByRole('button', { name: 'Undo' }).click(); await wait(800)
  return { ok: waits === 1 && trashed && closed === 0 && threads().length === 1 && !store().pages.find(p => p.id === 'notes').trashedAt, waits, trashed, closed }
})
await scenario('390: a sheet with a 16 px field; Enter is a new line and the button sends', async page => {
  await page.getByRole('button', { name: 'Page actions' }).first().tap(); await page.getByRole('menuitem', { name: 'Comment', exact: true }).tap(); await wait(300)
  const sheet = await pane(page).boundingBox(), size = await field(page).evaluate(n => getComputedStyle(n).fontSize), focused = await field(page).evaluate(n => n === document.activeElement)
  await field(page).tap(); await field(page).pressSequentially('one'); await page.keyboard.press('Enter'); await page.keyboard.type('two'); await wait(150)
  const none = threads().length, value = await field(page).inputValue()
  await pane(page).getByRole('button', { name: 'Comment', exact: true }).tap(); await wait(500)
  return { ok: sheet.width === 390 && sheet.y + sheet.height === 780 && size === '16px' && !focused && none === 0 && value === 'one\ntwo' && threads()[0].comments[0].body === 'one\ntwo', sheet, size, focused, none, value }
}, phone)
await scenario('At 1280 the pane sits beside what it is about: the page makes room, a side peek moves over and stays in sight, and Esc closes the pane first', async page => {
  await fromMenu(page); await wait(300)
  const box = l => l.first().boundingBox()
  const title = await box(page.locator('.page-title-field')), p1 = await box(pane(page))
  const r = { page: [title.x, title.x + title.width], pane: p1.x, overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) }
  await page.goto(`${base}/pages?page=books&peek=one&side=1`); await wait(1800)
  await page.locator('.peek .page-more').first().click(); await wait(250); await page.getByRole('menuitem', { name: 'Comment', exact: true }).click(); await wait(500)
  const peek = await box(page.locator('.peek')), p2 = await box(pane(page))
  r.peek = [peek.x, peek.x + peek.width]; r.pane2 = p2.x
  r.behind = (await box(page.locator('.app-main .large-title, .app-main .page-title-field'))).height
  await page.keyboard.press('Escape'); await wait(300)
  r.esc = [await pane(page).count(), await page.locator('.peek').count()]
  r.ok = r.page[1] <= r.pane && r.overflow <= 0 && r.peek[1] <= r.pane2 + 1 && r.peek[0] >= 260 && r.behind < 50 && r.esc[0] === 0 && r.esc[1] === 1
  return r
})
await scenario('A comment reads first: its Edit and Delete wait for the pointer, and Reply and Resolve are quiet', async page => {
  await fromMenu(page); await addComment(page, 'A note'); await wait(200); await page.mouse.move(2, 2); await wait(150)
  const r = { hidden: await pane(page).locator('.comment-actions').first().evaluate(e => getComputedStyle(e).opacity), weight: await pane(page).locator('.comment-thread-actions .app-link').first().evaluate(e => getComputedStyle(e).textDecorationLine) }
  await pane(page).locator('.comment').first().hover(); await wait(150)
  r.shown = await pane(page).locator('.comment-actions').first().evaluate(e => getComputedStyle(e).opacity)
  r.ok = r.hidden === '0' && r.shown === '1' && r.weight === 'none'
  return r
})
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
