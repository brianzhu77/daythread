// B44 (Jazz's states §1–§5, §9; Lead 17ab8da6 for §4a): pasting a link gives a plain link and a menu; every way out
// keeps the link; "Bookmark page" makes A2's card and page as a second undo step; a kept link is still remembered and
// goes with its line. Built server, sign-in off, a fresh store per run:
//   DB=<store> node tests/evidence/b44/menu-check.mjs <base> <keep|bookmark|several|typing|sentence|saved|phone-bookmark|three|good-stuffs|offline|offline-closed> [width]
import { chromium, webkit } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const [base, mode = 'keep', width = '1280'] = process.argv.slice(2), DB = process.env.DB
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || new URL(base).port === '3000' || !DB?.startsWith('/tmp/rb-b44-')) throw Error('Use a disposable loopback server and a fresh /tmp/rb-b44-* store')
const phone = Number(width) < 600, mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const browser = await (phone ? webkit : chromium).launch()
const context = await browser.newContext({ viewport: { width: Number(width), height: 900 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) })
let p = await context.newPage()
const errors = []; p.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log('pageerror', e.stack?.slice(0, 1200)) })
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width} ${mode}: ${what}${detail ? ` (${detail})` : ''}`) }
const q = (sql, ...args) => { const d = new DatabaseSync(DB, { readOnly: true }); try { return d.prepare(sql).all(...args) } finally { d.close() } }
/** Waits up to 6 s for the store to reach a state (saves land a moment after the edit). */
const until = async (check, ms = 6000) => { for (const end = Date.now() + ms; Date.now() < end; await p.waitForTimeout(200)) if (await check()) return true; return Boolean(await check()) }
const pagesFor = url => q("SELECT id, title FROM pages WHERE snapshot='current' AND url = ?", url)
const materialFor = url => q("SELECT id, sources FROM materials WHERE snapshot='current' AND url = ?", url)[0]
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const U = 'https://www.xiachufang.com/recipe/10324/', U2 = 'https://sspai.com/post/12345'
const menu = () => p.locator('.paste-menu')
const menuText = async () => (await menu().count()) ? (await menu().innerText()).replace(/\s+/g, ' ').trim() : ''
const paste = text => p.evaluate(v => { const dt = new DataTransfer(); dt.setData('text/plain', v); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, text)
const notes = `day:${today}:notes:template:0`
const clickNotes = () => p.locator(`.bn-block-outer[data-id="${notes}"] .bn-inline-content`).first().click()
const cards = () => p.locator('.continuous-editor [data-content-type="pageLink"]').count()
const lineTexts = () => p.locator('.continuous-editor .bn-inline-content').allInnerTexts()
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)

if (mode === 'keep') {
  await clickNotes(); await paste(U); await p.waitForTimeout(400)
  log((await lineTexts()).some(t => t.trim() === U) && await cards() === 0, 'the link goes in plain, no card', String(await cards()))
  log(/Keep as link.*Bookmark page.*New page in Today/.test(await menuText()) && await p.locator('#paste-menu-keep[aria-selected="true"]').count() === 1, 'the menu: Keep as link (highlighted), Bookmark page · New page in Today', await menuText())
  await p.waitForTimeout(1500)
  log(pagesFor(U).length === 0 && materialFor(U), 'no page made; the link is remembered (§4a)', JSON.stringify(materialFor(U)))
  await p.keyboard.press('Enter'); await p.waitForTimeout(800)
  log(await menu().count() === 0 && (await lineTexts()).filter(t => t.trim() === '').length >= 0 && pagesFor(U).length === 0, 'Enter keeps the link: the menu closes, nothing else happens')
  // Deleting the line (or ⌘Z of the paste) takes the remembered link with it.
  await p.keyboard.press(`${mod}+z`)
  log(await until(async () => !(await lineTexts()).some(t => t.includes('xiachufang')) && !materialFor(U)), '⌘Z undoes the paste, and the remembered link goes with it', JSON.stringify(materialFor(U) ?? null))
} else if (mode === 'bookmark') {
  await clickNotes(); await paste(U); await p.waitForTimeout(400)
  if (phone) await p.locator('#paste-menu-bookmark').tap()
  else { await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter') }
  await p.waitForTimeout(2500)
  const made = pagesFor(U)
  log(await cards() === 1 && made.length === 1, 'Bookmark page: the card and its page, A2\'s paste', JSON.stringify(made))
  log(/Made a page/.test(await p.locator('[role="alert"], [data-slot="toast"]').allInnerTexts().then(t => t.join(' | '))), 'A2\'s notice "Made a page · Undo"')
  log(materialFor(U) && JSON.parse(materialFor(U).sources).length === 1, 'one remembered item for the link, now on the card')
  if (!phone) {
    await p.keyboard.press(`${mod}+z`); await p.waitForTimeout(2500)
    log(await cards() === 0 && (await lineTexts()).some(t => t.includes('xiachufang')) && pagesFor(U).length === 0 && materialFor(U), '⌘Z (step 2) gives back the plain link: page gone, link still remembered', JSON.stringify({ pages: pagesFor(U), m: Boolean(materialFor(U)) }))
    await p.keyboard.press(`${mod}+z`)
    log(await until(async () => !(await lineTexts()).some(t => t.includes('xiachufang')) && !materialFor(U)), '⌘Z again (step 1) removes the paste and what it remembered', JSON.stringify(materialFor(U) ?? null))
  }
} else if (mode === 'several') {
  await clickNotes(); await paste(`${U}\n${U2}`); await p.waitForTimeout(400)
  const texts = await lineTexts()
  log(texts.some(t => t.trim() === U) && texts.some(t => t.trim() === U2), 'two plain links, one per line')
  log(/Bookmark 2 pages.*2 new pages in Today/.test(await menuText()), 'the menu reads "Bookmark 2 pages · 2 new pages in Today"', await menuText())
  await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
  log(await menu().count() === 0 && materialFor(U) && materialFor(U2) && pagesFor(U).length === 0, 'Esc keeps both, both remembered, no pages')
} else if (mode === 'typing') {
  await clickNotes(); await paste(U); await p.waitForTimeout(400)
  await p.keyboard.type(' x'); await p.waitForTimeout(400)
  log(await menu().count() === 0 && (await lineTexts()).some(t => t.includes(`${U} x`)), 'typing keeps the link: the menu closes and the keys type', JSON.stringify((await lineTexts()).find(t => t.includes('xiachufang'))))
} else if (mode === 'sentence') {
  await clickNotes(); await p.keyboard.type('see '); await paste(U); await p.waitForTimeout(500)
  log(await menu().count() === 0 && await cards() === 0, 'a URL pasted into a sentence: a normal paste, no menu')
} else if (mode === 'phone-bookmark') {
  // Ratchet: a tap on Bookmark used to move focus to the page (the keyboard dropped). The caret stays in the editor, on
  // the line after the card; the phone's Undo is the notice's (Bumblebee).
  await clickNotes(); await paste(U); await p.waitForTimeout(400)
  if (phone) await p.locator('#paste-menu-bookmark').tap(); else await p.locator('#paste-menu-bookmark').click()
  await p.waitForTimeout(2500)
  const caret = await p.evaluate(() => {
    const at = getSelection()?.anchorNode, el = at instanceof Element ? at : at?.parentElement, outer = el?.closest('.bn-block-outer')
    return { editor: Boolean(document.activeElement?.closest('.bn-editor')), afterCard: outer?.previousElementSibling?.querySelector('[data-content-type="pageLink"]') ? true : false }
  })
  log(caret.editor && caret.afterCard, 'after the tap the editor keeps focus, caret on the line after the card', JSON.stringify(caret))
  await p.locator('[role="alert"] button, [data-slot="toast"] button', { hasText: 'Undo' }).first()[phone ? 'tap' : 'click']()
  log(await until(async () => await cards() === 0 && (await lineTexts()).some(t => t.trim() === U) && pagesFor(U).length === 0 && materialFor(U)), 'the notice\'s Undo gives back the plain link, still remembered', JSON.stringify({ pages: pagesFor(U), m: materialFor(U) ?? null }))
} else if (mode === 'three') {
  // Ratchet: with three lines the menu sat under the phone toolbar and "Bookmark 3 pages" couldn't be tapped (§5).
  await clickNotes(); await paste(`${U}\n${U2}\nhttps://example.com/third`); await p.waitForTimeout(500)
  const boxes = await p.evaluate(() => { const r = s => document.querySelector(s)?.getBoundingClientRect(); const m = r('.paste-menu'), t = r('.editor-phone-toolbar'); return { menuTop: m?.top, menuBottom: m?.bottom, toolbarTop: t?.height ? t.top : null } })
  log(boxes.toolbarTop === null || boxes.menuBottom <= boxes.toolbarTop, 'the menu is clear of the phone toolbar', JSON.stringify(boxes))
  if (phone) await p.locator('#paste-menu-bookmark').tap(); else await p.locator('#paste-menu-bookmark').click()
  log(await until(async () => await cards() === 3), '"Bookmark 3 pages" makes three cards', String(await cards()))
} else if (mode === 'offline') {
  // Ratchet 517c25c: kept offline, the link was never remembered. The editor save carries it now, retries included.
  await clickNotes(); await context.setOffline(true); await paste(U); await p.waitForTimeout(800)
  await p.keyboard.press('Escape'); await p.waitForTimeout(2500)
  log(!materialFor(U), 'offline: nothing saved yet')
  await context.setOffline(false)
  log(await until(async () => Boolean(materialFor(U)) && (await lineTexts()).some(t => t.includes(U)), 15000), 'back online: the line and the remembered link are saved', JSON.stringify(materialFor(U) ?? null))
} else if (mode === 'offline-closed') {
  // Kept offline and the tab closed before it could save: its draft keeps the link, and the next tab to open the page
  // merges that draft and saves both (B35).
  await clickNotes(); await context.setOffline(true); await paste(U); await p.waitForTimeout(800)
  await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
  const slot = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daythread:editor:')).map(k => JSON.parse(localStorage.getItem(k)).keptPlainLinks ?? null))
  log(slot.some(x => x?.length === 1), 'the draft holds the kept link', JSON.stringify(slot))
  // WebKit doesn't always fire pagehide on a closed page, so the slot may not say "closed"; a short gone-after (B35's
  // check hook) makes it a gone tab's either way.
  await p.close({ runBeforeUnload: true }); await context.setOffline(false)
  await context.addInitScript(() => { globalThis.__daythreadGoneAfterMs = 1500 }); await new Promise(r => setTimeout(r, 1600))
  p = await context.newPage(); p.on('pageerror', e => errors.push(e.message))
  await p.goto(`${base}/`, { waitUntil: 'networkidle' })
  log(await until(async () => Boolean(materialFor(U)) && (await lineTexts()).some(t => t.includes(U)), 15000), 'another tab merges the draft, saves it and remembers the link', JSON.stringify({ m: materialFor(U) ?? null, line: (await lineTexts()).some(t => t.includes(U)), slots: await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daythread:editor:')).map(k => { const v = JSON.parse(localStorage.getItem(k)); return { closed: v.closed, claimed: Boolean(v.claimedBy), kept: v.keptPlainLinks?.length ?? 0, age: Date.now() - v.seen } })) }))
} else if (mode === 'good-stuffs') {
  // Ratchet: a link pasted into Good Stuffs and kept is a deliberate save; deleting its line keeps the item.
  const gs = `day:${today}:good-stuffs:template:0`
  await p.locator(`.bn-block-outer[data-id="${gs}"] .bn-inline-content`).first()[phone ? 'tap' : 'click'](); await paste(U); await p.waitForTimeout(400)
  await p.keyboard.press('Escape'); await p.waitForTimeout(400)
  log(await until(async () => materialFor(U) && !JSON.parse(materialFor(U).sources).some(x => x.plain)), 'kept in Good Stuffs: remembered, not as a plain link', JSON.stringify(materialFor(U) ?? null))
  await p.locator('.bn-inline-content', { hasText: U }).first().evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r) })
  await p.keyboard.press('Backspace'); await p.waitForTimeout(2500)
  log(!(await lineTexts()).some(t => t.includes('xiachufang')) && Boolean(materialFor(U)), 'deleting the line keeps the Good Stuffs save', JSON.stringify(materialFor(U) ?? null))
} else if (mode === 'saved') {
  // The link already has a page (bookmarked before): the second line says so.
  await clickNotes(); await paste(U); await p.waitForTimeout(400); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500)
  await p.locator('.continuous-editor .bn-inline-content').last().click(); await p.keyboard.press('Enter'); await paste(U); await p.waitForTimeout(500)
  log(/Saved before · Today/.test(await menuText()), 'a link with a page already: "Saved before · Today"', await menuText())
}
if (!p.isClosed()) await p.screenshot({ path: `/tmp/rb-b44-${mode}-${width}.png` })
log(errors.length === 0, 'no page errors', errors.slice(0, 2).map(e => e.replace(/payload=[^ ]*/, 'payload=…')).join(' / '))
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
