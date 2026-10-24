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
const notes = `day:${today}:good-stuffs:template:0`
const clickNotes = () => p.locator(`.bn-block-outer[data-id="${notes}"] .bn-inline-content`).first().click()
const cards = () => p.locator('.continuous-editor [data-content-type="pageLink"]').count()
const lineTexts = () => p.locator('.continuous-editor .bn-inline-content').allInnerTexts()
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)

await clickNotes();await paste(U);await p.waitForTimeout(1600);await p.keyboard.press('Escape');
console.log('before delete',materialFor(U));
await p.keyboard.press(`${mod}+a`);await p.keyboard.press('Backspace');await p.waitForTimeout(1800);
log(Boolean(materialFor(U)),'deliberate Good Stuffs material survives deleting its line',JSON.stringify(materialFor(U)??null));
log(errors.length===0,'no errors');await browser.close();process.exitCode=failed?1:0;
