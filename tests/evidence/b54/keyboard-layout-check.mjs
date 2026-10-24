// B54 + B55, the keyboard-up layout on a phone: the tab bar hides while a keyboard is up and comes back after; with
// the keyboard up, the caret's line and the line below it stay clear of the toolbar (the page scrolls; the toolbar
// stays put). The keyboard is faked as in scripts/phone-keyboard-check.mjs (B48). Built server, fresh store:
//   node tests/evidence/b54/keyboard-layout-check.mjs <base> [webkit|chromium]
import * as pw from '@playwright/test'
const [base, engine = 'webkit'] = process.argv.slice(2)
if (!base || new URL(base).hostname !== '127.0.0.1' || new URL(base).port === '3000') throw Error('Use a disposable loopback server')
const KEYBOARD = 336
const browser = await pw[engine].launch(), p = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
const errors = []; p.on('pageerror', e => errors.push(e.message))
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${engine}${iosRects ? ' ios-rects' : ''}: ${what}${detail ? ` (${detail})` : ''}`) }
// IOS_RECTS=1: measure like iOS Safari (getBoundingClientRect from the visible part, which iOS scrolls by offsetTop
// with the keyboard up), as scripts/phone-keyboard-check.mjs does for finding 11. The caret handle must still sit on
// the caret's line.
const iosRects = process.env.IOS_RECTS === '1'
await p.addInitScript(([keyboard, iosRects]) => {
  const vv = window.visualViewport
  let up = 0, scrolled = 0
  window.__scrollVisual = y => { scrolled = y; vv.dispatchEvent(new Event('scroll')) }
  if (iosRects) {
    const shift = r => new DOMRect(r.x, r.y - scrolled, r.width, r.height)
    for (const proto of [Element.prototype, Range.prototype]) {
      const rect = proto.getBoundingClientRect, rects = proto.getClientRects
      proto.getBoundingClientRect = function () { return shift(rect.call(this)) }
      proto.getClientRects = function () { return [...rects.call(this)].map(shift) }
    }
  }
  Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - up })
  Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => scrolled })
  const fire = () => vv.dispatchEvent(new Event('resize'))
  const typing = () => Boolean(document.activeElement?.closest('[contenteditable="true"], input, textarea'))
  document.addEventListener('focusin', () => setTimeout(() => { if (typing() && !up) { up = keyboard; fire() } }, 60))
  document.addEventListener('focusout', () => setTimeout(() => { if (!typing() && up) { up = 0; scrolled = 0; fire() } }, 60))
}, [KEYBOARD, iosRects])
const settle = () => p.waitForTimeout(400)
const tabBar = () => p.evaluate(() => { const t = document.querySelector('nav.tab-bar'); return t && getComputedStyle(t).display !== 'none' && t.getBoundingClientRect().height > 0 })
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })

await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
const later = p.getByRole('button', { name: 'Later', exact: true }); if (await later.count()) await later.tap()
log(await tabBar(), 'keyboard down: the tab bar shows')
const notes = p.locator(`.bn-block-outer[data-id="day:${today}:notes:template:0"] .bn-inline-content`).first()
await notes.tap(); await settle()
log(!(await tabBar()), 'keyboard up: the tab bar is hidden')
for (let i = 1; i <= 14; i++) { await p.keyboard.type(`line ${i}`); await p.keyboard.press('Enter') }
await settle()
// Put "line 6" just above the toolbar with "line 7" behind it, then move the caret onto line 6.
const geometry = () => p.evaluate(() => {
  const bar = document.querySelector('.editor-phone-toolbar').getBoundingClientRect()
  const line = t => [...document.querySelectorAll('.bn-editor [data-node-type="blockContainer"]')].find(b => b.querySelector('.bn-inline-content')?.textContent === t)?.querySelector('.bn-block-content').getBoundingClientRect()
  return { barTop: Math.round(bar.top), barBottom: Math.round(bar.bottom), line6: Math.round(line('line 6').bottom), line7: Math.round(line('line 7').bottom), visibleBottom: Math.round(visualViewport.offsetTop + visualViewport.height) }
})
let g = await geometry()
await p.evaluate(dy => window.scrollBy(0, dy), g.line6 - (g.barTop - 12)); await p.waitForTimeout(200)
const before = await geometry()
await p.locator('.bn-inline-content', { hasText: /^line 6$/ }).tap({ position: { x: 20, y: 8 } }); await settle()
const after = await geometry()
log(after.line6 <= after.barTop - 8 && after.line7 <= after.barTop - 8, 'the caret\'s line and the line below it are clear of the toolbar', JSON.stringify({ before, after }))
// A hidden empty row in between (a past day hides them, B19): the next line he can see has to clear instead.
await p.evaluate(() => { const b = [...document.querySelectorAll('.bn-editor [data-node-type="blockContainer"]')].find(x => x.querySelector('.bn-inline-content')?.textContent === 'line 10'); const st = document.createElement('style'); st.textContent = `.bn-block-outer[data-id="${CSS.escape(b.dataset.id)}"]{display:none}`; document.head.append(st) })
const g2 = () => p.evaluate(() => { const bar = document.querySelector('.editor-phone-toolbar').getBoundingClientRect(), line = t => [...document.querySelectorAll('.bn-editor [data-node-type="blockContainer"]')].find(b => b.querySelector('.bn-inline-content')?.textContent === t)?.querySelector('.bn-block-content').getBoundingClientRect()
  return { barTop: Math.round(bar.top), line9: Math.round(line('line 9').bottom), line11: Math.round(line('line 11').bottom) } })
let h = await g2()
await p.evaluate(dy => window.scrollBy(0, dy), h.line9 - (h.barTop - 12)); await p.waitForTimeout(200)
const hb = await g2()
await p.locator('.bn-inline-content', { hasText: /^line 9$/ }).tap({ position: { x: 20, y: 8 } }); await settle()
const ha = await g2()
log(ha.line9 <= ha.barTop - 8 && ha.line11 <= ha.barTop - 8, 'with a hidden row below, the next visible line clears too', JSON.stringify({ before: hb, after: ha }))
log(after.barBottom <= after.visibleBottom && after.barBottom >= after.visibleBottom - 16, 'the toolbar stays just above the keyboard', JSON.stringify(after))
log(!(await tabBar()), 'still typing: the tab bar stays hidden')
// iOS scrolls the visible part by 60 px: the caret handle stays on the caret's line (finding 11's correction).
await p.evaluate(() => window.__scrollVisual(60)); await p.waitForTimeout(300)
const handle = await p.evaluate(() => {
  const h = document.querySelector('.editor-touch-handle'), a = getSelection().anchorNode, e = a.nodeType === 1 ? a : a.parentElement
  const line = e.closest('[data-node-type="blockContainer"]').querySelector('.bn-block-content').getBoundingClientRect(), hr = h.getBoundingClientRect()
  return { handleMid: Math.round(hr.top + hr.height / 2), line: [Math.round(line.top), Math.round(line.bottom)] }
})
log(handle.handleMid >= handle.line[0] && handle.handleMid <= handle.line[1], `the caret handle sits on the caret's line with the visible part scrolled${iosRects ? ' (iOS rects)' : ''}`, JSON.stringify(handle))
await p.evaluate(() => window.__scrollVisual(0)); await p.waitForTimeout(200)
await p.locator('.editor-phone-toolbar [aria-label="Hide keyboard"]').tap(); await settle()
log(await tabBar(), 'keyboard down again: the tab bar is back')
log(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' / '))
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
