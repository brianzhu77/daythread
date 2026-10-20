// A2 in the built app (vite preview) on a copy of Brian's database: Jazz link-pages-states §6 checks 1–7 plus the
// plan's §7 browser cases (his real Notes bullets, ⌘Z, Undo mid-typing, a save still pending, two devices, Good Stuffs).
// Check 8 (server stopped mid-paste) is server-stop-check.sh.
//   node ui-check.mjs <base url> <db path> <pristine copy> <shots dir> <playwright index.mjs>
import { copyFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const [base, dbPath, pristine, out, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const today = '2026-10-20'
const errors = [], external = []
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
const reset = () => { for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true }); copyFileSync(pristine, dbPath) }
const sql = q => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare(q).all() } finally { d.close() } }
const linkPages = () => sql("SELECT id, title, url, parentId, trashedAt, trashId FROM pages WHERE snapshot='current' AND url IS NOT NULL")
const pageRow = id => sql(`SELECT * FROM pages WHERE snapshot='current' AND id='${id}'`)[0]
const flat = list => list.flatMap(n => [n, ...flat(n.children ?? [])])
const doc = id => JSON.parse(pageRow(id).editorJSON ?? '[]')
const text = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text ?? text(x.content)).join('') : ''
const b = await chromium.launch()
async function open(path = '/', width = 1280, ctx = b) {
  const p = await ctx.newPage({ viewport: { width, height: 900 } })
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  p.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) external.push(r.url()) })
  await p.goto(`${base}${path}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
  return p
}
const paste = (p, t) => p.evaluate(v => { const dt = new DataTransfer(); dt.setData('text/plain', v); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, t)
const block = (p, id) => p.locator(`.bn-block-outer[data-id="${id}"]`)
const clickLine = (p, id) => block(p, id).locator('.bn-inline-content').first().click()
const toast = p => p.locator('[role="alert"], [data-slot="toast"]').filter({ hasText: /./ })
const toastText = async p => (await toast(p).allInnerTexts()).join(' | ')
const toastUndo = p => toast(p).getByRole('button', { name: 'Undo' }).first()
const settle = p => p.waitForTimeout(1200)
const cards = async p => p.evaluate(() => [...document.querySelectorAll('.bn-block-outer')].filter(el => el.querySelector('[data-content-type="pageLink"]')).map(el => el.getAttribute('data-id')))
const notes = `day:${today}:notes:template:0`, gs = `day:${today}:good-stuffs:template:0`
const U = 'https://www.xiachufang.com/recipe/10324/'

// 1. One URL on today's empty Notes bullet → card, "Made a page · Undo", a child of today, empty, raw URL.
reset()
let p = await open()
await clickLine(p, notes); await paste(p, U); await settle(p)
let lp = linkPages()
log(lp.length === 1 && lp[0].parentId === `day:${today}` && lp[0].url === U && lp[0].title === 'xiachufang.com/recipe/10324', '1. one link page, child of today, raw URL, default title', JSON.stringify(lp[0]))
log(/Made a page/.test(await toastText(p)), '   notice "Made a page · Undo"')
const card1 = (await cards(p))[0]
log(Boolean(card1) && (await block(p, card1).innerText()).includes('xiachufang.com/recipe/10324'), '   the line is a link card with the default title')
log(await block(p, card1).locator('.editor-page-card-icon svg circle').count() === 1, '   globe icon on the card')
const body = pageRow(lp[0].id)
log(JSON.parse(body.sections).every(s => s.blocks.every(x => !x.text)), '   the page body is empty')
await p.screenshot({ path: `${out}/1280-made.png` })
await block(p, card1).locator('.editor-page-card').click(); await p.waitForTimeout(800)
log((await p.locator('.link-url-row').innerText()).includes(U), '   the page shows the URL row with the raw URL')
log(await p.locator('.link-url-open').getAttribute('href') === U && await p.locator('.link-url-open').getAttribute('target') === '_blank', '   "Open ↗" opens the site in a new tab')
log(/Today/.test(await p.locator('.doc-screen').innerText().then(t => t.split('\n').slice(0, 3).join(' '))), '   breadcrumb shows Today', (await p.locator('.doc-screen').innerText()).split('\n').slice(0, 3).join(' / '))
await p.screenshot({ path: `${out}/1280-link-page.png` })
await p.goto(`${base}/pages`, { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
const inDays = p.locator('.pages-in-days')
log((await inDays.innerText()).includes('xiachufang.com/recipe/10324') && await inDays.locator('svg circle').count() >= 1, '   Pages lists it under "In your days" with the globe')
await p.close()

// 4a. Undo right after 1 → the URL text again, the page gone from Pages and Trash.
reset(); p = await open()
await clickLine(p, notes); await paste(p, U); await settle(p)
let c = (await cards(p))[0]
await toastUndo(p).click(); await settle(p)
log(linkPages().length === 0 && sql("SELECT count(*) n FROM pages WHERE snapshot='current' AND trashedAt IS NOT NULL")[0].n === 0, '4. Undo after 1: page deleted, not in Trash')
let node = flat(doc(`day:${today}`)).find(n => n.id === c)
log(node?.type === 'bulletListItem' && JSON.stringify(node.content).includes(`"href":"${U}"`), '   the line is the URL text again, same block, still a bullet')
log((await block(p, c).innerText()).includes(U), '   the editor shows the URL line')
await p.close()

// 2. The same URL with host case + no trailing / on another day → "Saved before · Today", no second page.
reset(); p = await open()
await clickLine(p, notes); await paste(p, U); await settle(p)
const L = linkPages()[0].id
// His Sun Oct 18 page: the empty Events bullet he left there.
await p.goto(`${base}/day/2026-10-18`, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
let pasted2 = false
if (await block(p, 'e283f339-f3a4-41d2-a2b5-e3806a3f262b').count()) { await clickLine(p, 'e283f339-f3a4-41d2-a2b5-e3806a3f262b'); await paste(p, 'https://WWW.Xiachufang.com/recipe/10324/'); await settle(p); pasted2 = true }
lp = linkPages()
log(pasted2 && lp.length === 1 && lp[0].parentId === `day:${today}`, '2. same key (host case) on Sun Oct 18: no second page, first parent kept', `${lp.length} pages`)
log(/Saved before · Today/.test(await toastText(p)), '   notice "Saved before · Today"', await toastText(p))
// 4b. Undo after 2 → only the card goes.
await toastUndo(p).click(); await settle(p)
log(linkPages().length === 1, '4. Undo after 2: the page stays, only the card went')
await p.close()

// 3. Trash the page, paste the URL again → "Restored from trash", one page, live. 4c. Undo → back in the trash.
p = await open(`/pages?page=${encodeURIComponent(L)}`)
await p.getByRole('button', { name: 'Page actions' }).first().click(); await p.waitForTimeout(300)
await p.getByRole('menuitem', { name: 'Delete' }).first().click(); await settle(p)
log(Boolean(linkPages()[0]?.trashedAt), '3. setup: the link page is in the trash')
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
const emptyNotes = (await p.evaluate(() => [...document.querySelectorAll('.bn-block-outer')].filter(el => el.querySelector('[data-content-type="bulletListItem"]') && !el.innerText.trim()).map(el => el.getAttribute('data-id'))))
const target3 = emptyNotes.at(-1)
await clickLine(p, target3); await paste(p, 'https://xiachufang.com:443/recipe/10324/'.replace('https://', 'https://www.')); await settle(p)
lp = linkPages()
log(lp.length === 1 && !lp[0].trashedAt, '3. pasting it again restores it; one page, live')
log(/Restored from trash/.test(await toastText(p)), '   notice "Restored from trash"', await toastText(p))
await toastUndo(p).click(); await settle(p)
lp = linkPages()
log(Boolean(lp[0]?.trashedAt), '4. Undo after 3: back in the trash')
await p.close()

// 5. A URL in a sentence, in a task row, in a heading → nothing is made.
reset(); p = await open()
await clickLine(p, notes); await p.keyboard.type('see this '); await paste(p, U); await settle(p)
log(linkPages().length === 0, '5. pasted into a sentence: no page')
await clickLine(p, `day:${today}:other:template:0`); await paste(p, U); await settle(p)
log(linkPages().length === 0, '   pasted into a task row: no page')
await clickLine(p, `day:${today}:notes`); await p.keyboard.press('End'); await paste(p, U); await settle(p)
log(linkPages().length === 0, '   pasted into a heading: no page')
await p.close()

// 6. Three URL lines → three cards in order, one notice.
reset(); p = await open()
await clickLine(p, notes); await paste(p, 'https://a.example/one\n\nhttps://b.example/two\nhttps://c.example/three'); await settle(p)
lp = linkPages()
const cs = await cards(p)
log(lp.length === 3 && cs.length === 3, '6. three cards, three pages')
log(/Made 3 pages/.test(await toastText(p)) && (await toast(p).count()) <= 2, '   one notice "Made 3 pages"', await toastText(p))
await p.close()

// His real Notes bullets (Lead): a new nested bullet under 奥德赛 on Sun Oct 18 → the card stays at that level.
reset(); p = await open('/day/2026-10-18')
const nested = (await p.evaluate(() => [...document.querySelectorAll('.bn-block-outer')].map(el => ({ id: el.getAttribute('data-id'), t: el.innerText })))).find(x => x.t.startsWith('I choose to'))
if (nested) {
  await block(p, nested.id).locator('.bn-inline-content').first().click(); await p.keyboard.press('End'); await p.keyboard.press('Enter')
  await paste(p, 'https://example.com/odyssey-notes'); await settle(p)
  const d = doc('day:2026-10-18'), parent = flat(d).find(n => text(n.content) === '奥德赛')
  const kid = parent?.children?.find(n => n.type === 'pageLink')
  log(Boolean(kid), 'his Notes: the card sits as a nested bullet under 奥德赛', kid ? '' : JSON.stringify(parent?.children?.map(n => n.type)))
  await toastUndo(p).click(); await settle(p)
  const back = flat(doc('day:2026-10-18')).find(n => n.id === kid?.id)
  log(back?.type === 'bulletListItem' && flat(doc('day:2026-10-18')).find(n => text(n.content) === '奥德赛')?.children?.some(n => n.id === kid?.id), '   Undo: the URL bullet comes back at the same nesting')
} else log(false, 'his Notes: nested bullet under 奥德赛 not found')
await p.close()

// ⌘Z right after the paste = Undo; after an edit, ⌘Z is ordinary undo and the page stays.
reset(); p = await open()
await clickLine(p, notes); await paste(p, U); await settle(p)
await p.keyboard.press('Meta+z'); await settle(p)
log(linkPages().length === 0, '⌘Z right after the paste: same as Undo (page deleted, URL text back)')
reset(); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(700)
await clickLine(p, notes); await paste(p, U); await settle(p)
await p.keyboard.type('x'); await p.waitForTimeout(700)
await p.keyboard.press('Meta+z'); await settle(p)
log(linkPages().length === 1, '⌘Z after typing: ordinary undo; the page stays')
await p.close()

// Paste → type a note on the next line → tap Undo on the notice still showing: note kept, URL back, page deleted.
reset(); p = await open()
await clickLine(p, notes); await paste(p, U); await settle(p)
c = (await cards(p))[0]
await p.keyboard.type('my note'); await p.waitForTimeout(150)
await toastUndo(p).click(); await settle(p); await p.waitForTimeout(800)
let all = flat(doc(`day:${today}`))
log(linkPages().length === 0 && all.find(n => n.id === c)?.type === 'bulletListItem' && all.filter(n => text(n.content) === 'my note').length === 1, 'paste → note → Undo: note saved once, URL back, page deleted')
log(!/changed elsewhere/i.test(await p.locator('body').innerText()), '   no "changed elsewhere"')
await p.close()

// Undo mid-typing (Lead): keys typed while the Undo request is in flight; no save is sent until the reply.
reset(); p = await open()
const saves = []
await p.route('**/*', async route => {
  const body = route.request().postData() ?? ''
  if (body.includes('save-editor')) saves.push({ at: Date.now() })
  if (body.includes('undo-paste-links')) { saves.push({ undo: 'start', at: Date.now() }); await new Promise(r => setTimeout(r, 900)); await route.continue(); saves.push({ undo: 'sent', at: Date.now() }); return }
  await route.continue()
})
await clickLine(p, notes); await paste(p, U); await settle(p)
c = (await cards(p))[0]
saves.length = 0
const nextLine = (await p.evaluate(c => document.querySelector(`.bn-block-outer[data-id="${c}"]`)?.nextElementSibling?.getAttribute('data-id'), c))
await toastUndo(p).click(); await p.waitForTimeout(100)
await clickLine(p, nextLine); await p.keyboard.type('typed during undo'); await p.waitForTimeout(2500)
all = flat(doc(`day:${today}`))
const typed = all.filter(n => text(n.content).includes('typed during undo'))
log(all.find(n => n.id === c)?.type === 'bulletListItem' && linkPages().length === 0, 'Undo mid-typing: the card is the URL line again, the page deleted')
log(typed.length === 1 && text(typed[0].content) === 'typed during undo', '   every typed character is there exactly once', JSON.stringify(typed.map(n => text(n.content))))
const start = saves.findIndex(s => s.undo === 'start'), end = saves.findIndex(s => s.undo === 'sent')
const during = saves.slice(start + 1, end).filter(s => !s.undo).length, after = saves.slice(end + 1).filter(s => !s.undo).length
log(start >= 0 && during === 0 && after === 1, '   no save sent while Undo was out, exactly one after', JSON.stringify({ during, after }))
await p.waitForTimeout(800)
log(!flat(doc(`day:${today}`)).some(n => n.id === c && n.type === 'pageLink'), '   the next save does not bring the card back')
await p.close()

// A save still pending: type, then Undo before the debounce fires → the flush goes first; nothing lost.
reset(); p = await open()
await clickLine(p, notes); await paste(p, U); await settle(p)
await p.keyboard.type('quick'); await toastUndo(p).click(); await p.waitForTimeout(2000)
all = flat(doc(`day:${today}`))
log(linkPages().length === 0 && all.filter(n => text(n.content) === 'quick').length === 1 && !/changed elsewhere/i.test(await p.locator('body').innerText()), 'Undo with a save pending: flushed first, text kept once, page deleted')
await p.close()

// Two devices: B edits another line and its save lands; A then runs Undo while typing → A gets the conflict notice,
// B's line and A's typing are both kept; the card isn't undone.
reset()
const ctxA = await b.newContext(), ctxB = await b.newContext()
const A = await open('/', 1280, ctxA)
await clickLine(A, notes); await paste(A, U); await settle(A)
c = (await cards(A))[0]
const B = await open('/', 390, ctxB)
await clickLine(B, `day:${today}:events:template:0`); await B.keyboard.type('from the phone'); await B.waitForTimeout(1500)
log(flat(doc(`day:${today}`)).some(n => text(n.content) === 'from the phone'), 'two devices: B\'s line saved')
await A.route('**/*', async route => { if ((route.request().postData() ?? '').includes('undo-paste-links')) await new Promise(r => setTimeout(r, 600)); await route.continue() })
const nextA = (await A.evaluate(c => document.querySelector(`.bn-block-outer[data-id="${c}"]`)?.nextElementSibling?.getAttribute('data-id'), c))
const undoStatus = []
const poll = setInterval(async () => { try { undoStatus.push(await A.locator('.editor-save-line').first().innerText()) } catch {} }, 40)
await toastUndo(A).click(); await A.waitForTimeout(80); await clickLine(A, nextA); await A.keyboard.type('A typing'); await A.waitForTimeout(2500); clearInterval(poll)
all = flat(doc(`day:${today}`))
log(all.some(n => text(n.content) === 'from the phone'), '   B\'s line is not overwritten')
log(undoStatus.some(t => /Couldn't undo · page changed elsewhere/.test(t)), '   A\'s Undo is refused: "Couldn\'t undo · page changed elsewhere"', JSON.stringify(undoStatus))
log(linkPages().length === 1 && flat(doc(`day:${today}`)).some(n => n.id === c && n.type === 'pageLink'), '   nothing was undone: the page and the card stay')
log((await A.locator('.bn-editor').innerText()).includes('A typing') && (await A.locator('.bn-editor').innerText()).includes('from the phone'), '   A\'s editor keeps its typing and now shows B\'s line')
await A.waitForTimeout(1500)
const afterA = flat(doc(`day:${today}`))
log(afterA.some(n => text(n.content) === 'from the phone') && afterA.filter(n => text(n.content).includes('A typing')).length === 1, '   both are saved, each once')
await B.reload({ waitUntil: 'networkidle' }); await B.waitForTimeout(600)
await ctxA.close(); await ctxB.close()

// Undo on one device, the other reloads: it shows the URL text.
reset()
const ctxC = await b.newContext(), ctxD = await b.newContext()
const C = await open('/', 1280, ctxC)
await clickLine(C, notes); await paste(C, U); await settle(C)
c = (await cards(C))[0]
const D = await open('/', 390, ctxD)
log((await cards(D)).includes(c), 'two devices: the other one shows the card')
await toastUndo(C).click(); await settle(C)
await D.reload({ waitUntil: 'networkidle' }); await D.waitForTimeout(600)
log(!(await cards(D)).includes(c) && (await block(D, c).innerText()).includes(U), '   after Undo on one, the other shows the URL line')
await ctxC.close(); await ctxD.close()

// Good Stuffs: a follow-up record; Undo → a normal save → reload: no record and no source for that line.
reset(); p = await open()
await clickLine(p, gs); await paste(p, 'https://gs.example/article'); await settle(p)
const m1 = sql("SELECT id, url, sources FROM materials WHERE snapshot='current'")
log(m1.length === 1 && m1[0].url === 'https://gs.example/article', 'Good Stuffs: one follow-up record for the link page')
c = (await cards(p))[0]
await toastUndo(p).click(); await settle(p)
await clickLine(p, notes); await p.keyboard.type('later'); await p.waitForTimeout(1500)
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800)
log(sql("SELECT count(*) n FROM materials WHERE snapshot='current'")[0].n === 0, '   Undo → a normal save → reload: no record, the line not collected again')
await p.close()

// Real clipboards (Bumblebee ede057e9): a link copied from a page (plain text = its title, the URL only in the HTML),
// Copy Link (plain URL + an <a>), the iOS share sheet (text/uri-list); a sentence around a link stays a normal paste.
const pasteData = (p, data) => p.evaluate(d => { const dt = new DataTransfer(); for (const [k, v] of Object.entries(d)) dt.setData(k, v); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, data)
for (const [name, data, url, title] of [
  ['a link copied as text from a page (plain = its text, URL only in the HTML)', { 'text/plain': '韩国大酱汤 (正宗)', 'text/html': '<meta charset="utf-8"><a href="https://www.xiachufang.com/recipe/10324/">韩国大酱汤 (正宗)</a>' }, 'https://www.xiachufang.com/recipe/10324/', '韩国大酱汤 (正宗)'],
  ['Copy Link (plain URL and an <a>)', { 'text/plain': 'https://copy.example/link', 'text/html': '<a href="https://copy.example/link">https://copy.example/link</a>' }, 'https://copy.example/link', 'copy.example/link'],
  ['the iOS share sheet (text/uri-list)', { 'text/uri-list': 'https://share.example/item', 'text/plain': 'Shared item' }, 'https://share.example/item', 'share.example/item'],
]) {
  reset(); p = await open()
  await clickLine(p, notes); await pasteData(p, data); await settle(p)
  lp = linkPages()
  log(lp.length === 1 && lp[0].url === url && lp[0].title === title, `clipboard: ${name} → one link page titled "${title}"`, JSON.stringify(lp[0] ?? null))
  if (title === '韩国大酱汤 (正宗)') {
    const card = (await cards(p))[0]
    log((await block(p, card).locator('.editor-page-card-domain').innerText()) === 'xiachufang.com', '   the card shows the link text and the domain (Lead aa5d532f)')
    await toastUndo(p).click(); await settle(p)
    log(linkPages().length === 0, '   Undo still deletes it: the link-text title is its first title, not an edit')
  }
  await p.close()
}
reset(); p = await open()
await clickLine(p, notes); await pasteData(p, { 'text/plain': 'one two', 'text/html': '<a href="https://one.example/">one</a> <a href="https://two.example/">two</a>' }); await settle(p)
log(linkPages().length === 0, 'clipboard: HTML with two links → normal paste, no page')
await p.close()
for (const [name, html] of [['a link next to an image', '<a href="https://img.example/">韩国大酱汤</a><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">'], ['an image inside the link', '<a href="https://img.example/"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">韩国大酱汤</a>']]) {
  reset(); p = await open()
  await clickLine(p, notes); await pasteData(p, { 'text/plain': '韩国大酱汤', 'text/html': html }); await settle(p)
  log(linkPages().length === 0, `clipboard: ${name} → normal paste, no page (Ratchet 2aea0960)`)
  await p.close()
}
reset(); p = await open()
await clickLine(p, notes); await pasteData(p, { 'text/plain': '韩国大酱汤', 'text/html': '<meta charset="utf-8"><span style="color: rgb(0,0,0)"><a href="https://wrap.example/">韩国大酱汤</a></span><br>' }); await settle(p)
log(linkPages().length === 1 && linkPages()[0].title === '韩国大酱汤', 'clipboard: a link in the wrappers a browser adds (meta, span, br) still makes a page')
await p.close()
reset(); p = await open()
await clickLine(p, notes); await pasteData(p, { 'text/plain': 'see 韩国大酱汤 here', 'text/html': 'see <a href="https://x.example/">韩国大酱汤</a> here' }); await settle(p)
log(linkPages().length === 0, 'clipboard: a sentence around a link → normal paste, no page')
await p.close()

// ↗ is a quiet secondary action (Jazz, Lead aa5d532f).
reset(); p = await open()
await clickLine(p, notes); await paste(p, U); await settle(p)
log(await p.locator('.editor-page-card-open').first().evaluate(a => getComputedStyle(a).color) !== 'rgb(0, 0, 238)', '↗ uses --ink-3, not the browser link blue', await p.locator('.editor-page-card-open').first().evaluate(a => getComputedStyle(a).color))
await p.close()

// 7 + 390: a long Chinese-path URL; the card is one line and ↗ stays put.
reset(); p = await open('/', 390)
const long = 'https://zh.wikipedia.org/wiki/%E9%9F%A9%E5%9B%BD%E5%A4%A7%E9%85%B1%E6%B1%A4%E7%9A%84%E5%81%9A%E6%B3%95%E5%92%8C%E5%8E%86%E5%8F%B2?section=%E9%85%8D%E6%96%99'
await clickLine(p, notes); await paste(p, long); await settle(p)
c = (await cards(p))[0]
const box = await block(p, c).locator('.editor-page-card-row').boundingBox(), open7 = await block(p, c).locator('.editor-page-card-open').boundingBox()
log(box && box.height <= 46 && open7 && open7.x + open7.width <= 390, '7. 390: the card is one line, ↗ inside the screen', JSON.stringify({ h: box?.height, x: open7?.x, w: open7?.width }))
log((await block(p, c).innerText()).includes('韩国大酱汤'), '   the default title reads the Chinese path')
log(open7 && open7.width >= 44 && open7.height >= 44, '   ↗ is a 44 px target')
await p.screenshot({ path: `${out}/390-long-card.png` })
await block(p, c).locator('.editor-page-card').click(); await p.waitForTimeout(800)
const row = await p.locator('.link-url-row').boundingBox()
log(row && row.height <= 46, '   the URL row is one line at 390', JSON.stringify(row))
await p.screenshot({ path: `${out}/390-link-page.png` })
await p.close()

log(external.length === 0, 'no request left the app', external.slice(0, 3).join(' '))
log(errors.length === 0, 'no page or console errors', errors.slice(0, 3).join(' | '))
await b.close()
