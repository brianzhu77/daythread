// B88: opening a page ending in a block with no text leaves no caret, so no key changes anything, by every way in. Clicking below still gives a line, choosing a block on purpose still works, and its Undo brings back the lot.
// Usage: node tests/evidence/opening/opening.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/opening/opening.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const seed = () => execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/opening/seed.ts ${S}`, { stdio: 'ignore' })
const data = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
// Blocks, their text and whether anything went to Trash: a save can tidy a block's props without anyone pressing anything.
const shape = n => [n.id, n.type, Array.isArray(n.content) ? n.content.map(c => c.text ?? '').join('') : null, (n.children ?? []).map(shape)]
const snapshot = () => Object.fromEntries(data().pages.map(p => [p.id, [JSON.parse(p.document || '[]').map(shape), Boolean(p.trashedAt)]]))
const changed = (a, b) => Object.keys(b).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(k => [k, a[k], b[k]])
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const fresh = async (width = 1280) => { const c = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' }), p = await c.newPage(); const errors = []; p.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) }); return { c, p, errors, wait: ms => p.waitForTimeout(ms) } }
const inEditor = p => p.evaluate(() => Boolean(document.activeElement?.closest?.('.ProseMirror')))
const tryKeys = async (p, wait, name) => {
  const before = snapshot(), at = p.url()
  check(!(await inEditor(p)), `${name}: no caret`)
  for (const key of ['Backspace', 'Delete', 'x']) { await p.keyboard.press(key); await wait(350) }
  await wait(1100)
  check(p.url() === at, `${name}: still on the same page`, p.url())
  const diff = changed(before, snapshot())
  check(diff.length === 0, `${name}: Backspace, Delete and a letter change nothing`, diff.length ? diff : undefined)
}
// (1) Each block with no text, on a reload, at both widths.
seed()
for (const width of [1280, 390]) for (const page of ['home', 'alone', 'linked', 'todos', 'card', 'divider', 'synced']) {
  const { c, p, errors, wait } = await fresh(width)
  await p.goto(`${base}/pages?page=${page}`); await wait(2200)
  await tryKeys(p, wait, `${width} ${page}`)
  check(errors.length === 0, `${width} ${page}: no page errors`, errors)
  if (shots && width === 1280 && page === 'alone') await p.screenshot({ path: `${shots}/${engine}-alone.png` })
  await c.close()
}
// (2) The other ways in.
{ const { c, p, errors, wait } = await fresh()
  await p.goto(`${base}/pages?page=endsline`); await wait(2200)
  await p.locator('.sidebar a, .sidebar button', { hasText: /^home$/ }).first().click(); await wait(1800)
  check(p.url().includes('page=home'), 'moved to it within the app', p.url())
  await tryKeys(p, wait, 'moving in the app')
  await p.goto(`${base}/pages?page=home&peek=one`); await wait(2200)
  check(await p.locator('.peek').count() === 1, 'a row in a center peek')
  await tryKeys(p, wait, 'center peek')
  await p.goto(`${base}/pages?page=home&peek=one&side=1`); await wait(2200)
  check(await p.locator('.peek.is-side').count() === 1, 'a row in a side peek')
  await tryKeys(p, wait, 'side peek')
  await p.goto(`${base}/pages?page=home`); await wait(2200)
  await p.evaluate(() => { window.dispatchEvent(new Event('blur')); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) }); await wait(300)
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) }); await wait(500)
  await tryKeys(p, wait, 'back to the tab (simulated)')
  check(errors.length === 0, 'ways in: no page errors', errors)
  await c.close() }
// A page ending in a line opens ready to type, as before.
{ const { c, p, wait } = await fresh()
  await p.goto(`${base}/pages?page=endsline`); await wait(2200)
  check(await inEditor(p), 'a page ending in a line opens with the caret')
  await p.keyboard.type('!'); await wait(3000)
  check(data().pages.find(x => x.id === 'endsline').document.includes('The line below!'), 'and typing goes there')
  await c.close() }
// (4) Clicking below the block gives a line, in the strip just under it and in the space further down, with a line above it or none.
const clickBelow = async (page, dy, what) => {
  seed()
  const { c, p, wait } = await fresh()
  await p.goto(`${base}/pages?page=${page}`); await wait(2200)
  const box = await p.locator('.database-block').first().boundingBox()
  await p.mouse.click(box.x + 100, box.y + box.height + dy); await wait(500)
  await p.keyboard.type('Below it'); await wait(3000)
  const nodes = JSON.parse(data().pages.find(x => x.id === page).document)
  check(nodes.at(-1).content?.[0]?.text === 'Below it' && nodes.some(n => n.type === 'database'), `clicking ${what} on ${page} gives a line to type in`, nodes.map(n => [n.type, n.content?.[0]?.text]))
  await c.close()
}
for (const page of ['home', 'alone']) for (const [dy, what] of [[30, 'just under the block'], [60, 'further down']]) await clickBelow(page, dy, what)
// A click beside the block, or in the space below a page ending in a line, isn't taken for this.
seed()
{ const { c, p, wait } = await fresh()
  await p.goto(`${base}/pages?page=endsline`); await wait(2200)
  const box = await p.locator('.ProseMirror').first().boundingBox()
  await p.mouse.click(box.x + 100, box.y + box.height - 20); await wait(400)
  await p.keyboard.type('!'); await wait(3000)
  check(JSON.parse(data().pages.find(x => x.id === 'endsline').document).length === 2 && data().pages.find(x => x.id === 'endsline').document.includes('The line below!'), 'below a page ending in a line, the caret goes to that line, as before')
  await c.close() }
// Selected on opening isn't drawn as chosen until the editor has focus. Chosen by its handle, the bar says so.
const drawn = p => p.evaluate(() => { const el = document.querySelector('.bn-block-content.ProseMirror-selectednode, .ProseMirror-selectednode > .bn-block-content'); return el ? [...el.children].some(ch => getComputedStyle(ch, '::after').content !== 'none') : false })
seed()
{ const { c, p, wait } = await fresh()
  await p.goto(`${base}/pages?page=alone`); await wait(2200)
  check(!(await drawn(p)), 'a page holding only a database opens with it not drawn as chosen')
  await p.evaluate(() => document.querySelector('.bn-editor').focus()); await wait(300)
  check(await drawn(p), 'with the editor focused it is drawn')
  await p.reload(); await wait(2200)
  await p.locator('.database-block').first().hover(); await wait(300)
  await p.locator('.bn-side-menu [aria-label^="Select or drag"]').first().click(); await wait(400)
  check(await p.locator('.continuous-editor.has-selection').count() === 1, 'chosen by its handle, the bar says so')
  await c.close() }
// (5) Choosing it on purpose still removes it, and one Undo brings back the block, the database and its rows.
seed()
{ const { c, p, wait } = await fresh()
  await p.goto(`${base}/pages?page=home`); await wait(2200)
  await p.locator('.database-block').first().hover(); await wait(300)
  await p.locator('.bn-side-menu [aria-label^="Select or drag"]').first().click(); await wait(400)
  await p.keyboard.press('Backspace'); await wait(1500)
  const gone = data().pages.find(x => x.id === 'home-db').trashedAt, notice = (await p.locator('[role=alert], [role=status]').allInnerTexts()).join(' | ').replace(/\s+/g, ' ')
  check(Boolean(gone) && !JSON.parse(data().pages.find(x => x.id === 'home').document).some(n => n.type === 'database'), 'chosen by its handle, Backspace removes it', notice)
  await p.getByRole('button', { name: 'Undo' }).first().click(); await wait(1600)
  const ws = data()
  check(!ws.pages.find(x => x.id === 'home-db').trashedAt && !ws.pages.find(x => x.id === 'one').trashedAt && !ws.pages.find(x => x.id === 'two').trashedAt && JSON.parse(ws.pages.find(x => x.id === 'home').document).some(n => n.type === 'database') && await p.locator('tr.database-row').count() === 2, 'one Undo brings back the block, the database and its rows')
  await c.close() }
// B89: a key on a line never removes the block next to it, wherever the caret came from.
const blocks = id => JSON.parse(data().pages.find(x => x.id === id).document)
const types = id => blocks(id).map(n => n.type)
const onPage = async (id, go, width = 1280) => { const f = await fresh(width); await f.p.goto(`${base}/pages?page=${id}`); await f.wait(2200); await go(f); check(f.errors.length === 0, `${id}: no page errors`, f.errors); await f.c.close() }
const caretIn = async (p, text, where) => { await p.locator('.bn-inline-content', { hasText: text }).first().click(); await p.keyboard.press(engine === 'webkit' ? (where === 'end' ? 'Meta+ArrowRight' : 'Meta+ArrowLeft') : (where === 'end' ? 'End' : 'Home')); await p.waitForTimeout(150) } // On a Mac, WebKit's Home and End scroll the page.
seed()
for (const [id, name] of [['bdb', 'database'], ['bcard', 'card'], ['bsynced', 'synced block']]) {
  await onPage(id, async ({ p, wait }) => {
    const before = snapshot()
    await caretIn(p, 'Above', 'end'); await p.keyboard.press('Delete'); await wait(300)
    await caretIn(p, 'Below', 'start'); await p.keyboard.press('Backspace'); await wait(1600)
    const diff = changed(before, snapshot())
    check(diff.length === 0, `${name}: Delete on the line above and Backspace on the line below change nothing`, diff.length ? diff : undefined)
  })
}
await onPage('bdivider', async ({ p, wait }) => {
  await caretIn(p, 'Above', 'end'); await p.keyboard.press('Delete'); await wait(1600)
  check(!types('bdivider').includes('divider'), 'a divider still goes, as it does today', types('bdivider'))
})
seed()
// Ratchet's case: opening on an empty line above a database, with nothing clicked.
await onPage('emptyabove', async ({ p, wait }) => {
  check(await inEditor(p), 'an empty line above a database has the caret on opening')
  await p.keyboard.press('Delete'); await wait(1600)
  check(types('emptyabove').join() === 'database' && !data().pages.find(x => x.id === 'home-db').trashedAt, 'Delete there removes the line and leaves the database', types('emptyabove'))
  await p.keyboard.press('Delete'); await p.keyboard.press('Backspace'); await wait(1600)
  check(types('emptyabove').join() === 'database', 'and pressing on changes nothing', types('emptyabove'))
})
await onPage('emptybelow', async ({ p, wait }) => {
  await p.locator('[data-id="eb-0"] .bn-inline-content').click(); await wait(200)
  await p.keyboard.press('Backspace'); await wait(1600)
  check(types('emptybelow').join() === 'paragraph,database,paragraph', 'Backspace on an empty line below a database removes the line', types('emptybelow'))
  await p.keyboard.press('Backspace'); await wait(1600)
  check(types('emptybelow').join() === 'paragraph,database,paragraph' && blocks('emptybelow').at(-1).content[0].text === 'Below', 'and again changes nothing: the caret is on the next line', blocks('emptybelow').map(n => n.content?.[0]?.text))
})
await onPage('emptylast', async ({ p, wait }) => {
  await p.locator('[data-id="el-0"] .bn-inline-content').click(); await wait(200)
  await p.keyboard.press('Delete'); await wait(1600)
  check(types('emptylast').join() === 'database', 'Delete on an empty last line below a database removes the line', types('emptylast'))
  check(!(await inEditor(p)), 'and leaves no caret')
  await p.keyboard.press('Delete'); await p.keyboard.press('Backspace'); await wait(1600)
  check(types('emptylast').join() === 'database', 'and pressing on changes nothing', types('emptylast'))
})
// A held key clears the line and stops there.
const hold = async (p, key, times) => { for (let i = 0; i < times; i++) { await p.keyboard.down(key); await p.waitForTimeout(25) } await p.keyboard.up(key) }
await onPage('heldup', async ({ p, wait }) => {
  await caretIn(p, 'Clear me', 'end'); await hold(p, 'Backspace', 30); await wait(1600)
  const b = blocks('heldup')
  check(b.length === 2 && b[0].type === 'database' && !(b[1].content?.length), 'holding Backspace clears the line below a database and stops', b.map(n => [n.type, n.content?.[0]?.text]))
})
await onPage('helddown', async ({ p, wait }) => {
  await caretIn(p, 'Clear me', 'start'); await hold(p, 'Delete', 30); await wait(1600)
  const b = blocks('helddown')
  check(b.length === 2 && b[1].type === 'database' && !(b[0].content?.length), 'holding Delete clears the line above a database and stops', b.map(n => [n.type, n.content?.[0]?.text]))
})
// A bullet or a heading below a table turns into a line first, and that's as far as it goes, words kept.
await onPage('kinds', async ({ p, wait }) => {
  for (const [text, id] of [['Bullet', 'k-bul'], ['Heading', 'k-head']]) {
    await caretIn(p, text, 'start'); await p.keyboard.press('Backspace'); await wait(200); await p.keyboard.press('Backspace'); await wait(200); await p.keyboard.press('Backspace'); await wait(1600)
    const b = blocks('kinds').find(n => n.id === id)
    check(b?.type === 'paragraph' && b.content?.[0]?.text === text && blocks('kinds').filter(n => n.type === 'database').length === 2, `${text} below a table becomes a line and stops, words kept`, blocks('kinds').map(n => [n.type, n.content?.[0]?.text]))
  }
})
// From the title, and by arrow from a line: arriving at a block isn't choosing it.
seed()
for (const id of ['alone', 'cardonly']) for (const key of ['Tab', 'Enter', 'ArrowDown']) await onPage(id, async ({ p, wait }) => {
  await p.locator('.page-title-field').click(); await p.keyboard.press(engine === 'webkit' ? 'Meta+ArrowRight' : 'End'); await p.keyboard.press(key); await wait(300)
  const before = snapshot(), title = await p.locator('.page-title-field').innerText()
  for (const k of ['Backspace', 'Delete', 'Backspace']) { if (await p.evaluate(() => document.activeElement?.classList.contains('page-title-field'))) break; await p.keyboard.press(k); await wait(300) }
  await wait(1300)
  const diff = changed(before, snapshot())
  check(diff.length === 0, `${id}: ${key} from the title, then Backspace and Delete, remove nothing`, diff.length ? diff : undefined)
  check(title === id, `${id}: the title is unchanged`, title)
})
await onPage('home', async ({ p, wait }) => {
  const before = snapshot()
  await caretIn(p, 'The line above', 'end'); await p.keyboard.press('ArrowDown'); await wait(250); await p.keyboard.press('Backspace'); await wait(250); await p.keyboard.press('Delete'); await wait(1400)
  const diff = changed(before, snapshot())
  check(diff.length === 0, 'arriving at a database by arrow, Backspace and Delete remove nothing', diff.length ? diff : undefined)
})
// Esc from the table is choosing it, as its handle is.
await onPage('home', async ({ p, wait }) => {
  await p.locator('.database-block [contenteditable], .database-block .database-title, .database-block input').first().click(); await wait(250)
  await p.keyboard.press('Escape'); await wait(400)
  check(await p.locator('.continuous-editor.has-selection').count() === 1, 'Esc from the table chooses the block, and the bar says so')
  await p.keyboard.press('Backspace'); await wait(1600)
  check(!types('home').includes('database'), 'and Backspace removes it, as chosen', types('home'))
  await p.getByRole('button', { name: 'Undo' }).first().click(); await wait(1600)
  check(types('home').includes('database') && !data().pages.find(x => x.id === 'home-db').trashedAt, 'and one Undo brings it back', types('home'))
})
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
