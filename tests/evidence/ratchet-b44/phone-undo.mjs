// B44 (Jazz's states §1–§5, §9; Lead 17ab8da6 for §4a): pasting a link gives a plain link and a menu; every way out
// keeps the link; "Bookmark page" makes A2's card and page as a second undo step; a kept link is still remembered and
// goes with its line. Built server, sign-in off, a fresh store per run:
//   DB=<store> node tests/evidence/b44/menu-check.mjs <base> <keep|bookmark|several|typing|sentence|saved> [width]
import { chromium, webkit } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const [base, mode = 'keep', width = '1280'] = process.argv.slice(2), DB = process.env.DB
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || new URL(base).port === '3000' || !DB?.startsWith('/tmp/rb-b44-')) throw Error('Use a disposable loopback server and a fresh /tmp/rb-b44-* store')
const phone = Number(width) < 600, mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const browser = await (phone ? webkit : chromium).launch()
const p = await browser.newPage({ viewport: { width: Number(width), height: 900 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) })
const errors = []; p.on('pageerror', e => errors.push(e.message))
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
  if (true) {
    console.log('focus',await p.evaluate(()=>({tag:document.activeElement?.outerHTML.slice(0,180),selection:window.getSelection()?.toString()})));
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
} else if (mode === 'saved') {
  // The link already has a page (bookmarked before): the second line says so.
  await clickNotes(); await paste(U); await p.waitForTimeout(400); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500)
  await p.locator('.continuous-editor .bn-inline-content').last().click(); await p.keyboard.press('Enter'); await paste(U); await p.waitForTimeout(500)
  log(/Saved before · Today/.test(await menuText()), 'a link with a page already: "Saved before · Today"', await menuText())
}
await p.screenshot({ path: `/tmp/rb-b44-${mode}-${width}.png` })
log(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' / '))
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
