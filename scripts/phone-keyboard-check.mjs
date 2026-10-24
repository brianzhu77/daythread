// B48 check: on a phone the editor toolbar sits just above the keyboard, not behind it. Headless browsers can't raise
// an iOS keyboard, so this fakes one: visualViewport.height shrinks by the keyboard's height when the editor takes
// focus, and offsetTop stands for iOS scrolling the visible part of the page. Covers the first, second and third
// focus, a scrolled view, the caret moving between lines with the keyboard up, the keyboard down, the Aa panel and
// B44's paste menu. Run against an isolated server on a disposable store (it types on today's page), never live.
// Usage: [IOS_RECTS=1] node scripts/phone-keyboard-check.mjs <base-url> [webkit|chromium]
import assert from 'node:assert/strict'
import * as pw from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:3513'
const engine = process.argv[3] ?? 'webkit'
const KEYBOARD = 336 // an iPhone keyboard with its suggestion bar, in CSS px
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
const errors = []
page.on('pageerror', e => errors.push(e.message))
// IOS_RECTS=1 also measures like iOS Safari: getBoundingClientRect from the visible part, which iOS scrolls by
// offsetTop, while fixed elements are still placed from the layout viewport (finding 11, Ratchet's trace).
const iosRects = process.env.IOS_RECTS === '1'
await page.addInitScript(([keyboard, iosRects]) => {
  const vv = window.visualViewport
  let up = 0, scrolled = 0
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
  const fire = () => { vv.dispatchEvent(new Event('resize')); vv.dispatchEvent(new Event('scroll')) }
  window.__iosRects = iosRects
  window.__scrollVisual = y => { scrolled = y; vv.dispatchEvent(new Event('scroll')) }
  // Like iOS: the keyboard comes up a moment after the editor takes focus and goes when it loses it.
  const editing = () => Boolean(document.activeElement?.closest('[contenteditable="true"]'))
  document.addEventListener('focusin', () => setTimeout(() => { if (editing() && !up) { up = keyboard; fire() } }, 60))
  document.addEventListener('focusout', () => setTimeout(() => { if (!editing() && up) { up = 0; scrolled = 0; fire() } }, 60))
}, [KEYBOARD, iosRects])
const settle = () => page.waitForTimeout(350)
const visible = () => page.evaluate(() => {
  const vv = window.visualViewport, bar = document.querySelector('.editor-phone-toolbar')
  const box = el => { const r = el?.getBoundingClientRect(); return r && r.height ? { top: Math.round(r.top), bottom: Math.round(r.bottom) } : null }
  // What he can see, in measured coordinates: from offsetTop where rects are measured from the layout viewport, from 0
  // where they're measured from the visible part (iOS).
  const top = window.__iosRects ? 0 : vv.offsetTop
  const pasted = [...document.querySelectorAll('.bn-inline-content')].find(e => e.textContent.includes('b48-keyboard'))
  return { top, bottom: Math.round(top + vv.height), keyboard: Math.round(window.innerHeight - vv.height), toolbar: box(bar), panel: box(document.querySelector('.editor-style-panel')), menu: box(document.querySelector('.paste-menu')), line: box(pasted) }
})
// The paste menu sits right against its line, under it or above it (finding 11: on iOS it was 60 px off).
const besideLine = (v, what) => {
  assert.ok(v.line && v.menu, `${what}: line and menu measured`)
  const gap = v.menu.bottom <= v.line.top ? v.line.top - v.menu.bottom : v.menu.top - v.line.bottom
  assert.ok(gap >= 0 && gap <= 12, `${what}: paste menu next to its line (gap ${gap}) ${JSON.stringify(v)}`)
}
const aboveKeyboard = (v, what) => {
  assert.ok(v.toolbar, `${what}: toolbar shown`)
  assert.ok(v.toolbar.bottom <= v.bottom && v.toolbar.bottom >= v.bottom - 16, `${what}: toolbar just above the keyboard (toolbar ${v.toolbar.bottom}, visible bottom ${v.bottom})`)
  assert.ok(v.toolbar.top >= v.top, `${what}: toolbar inside the visible part`)
}
const lineAfter = heading => page.evaluate(heading => {
  const blocks = [...document.querySelectorAll('[data-node-type="blockContainer"]')]
  const at = blocks.findIndex(b => b.querySelector('[data-content-type="heading"]')?.textContent.trim() === heading)
  return blocks[at + 1]?.dataset.id
}, heading)
const tapLine = async id => { await page.locator(`[data-node-type="blockContainer"][data-id="${id}"] [data-content-type]`).first().tap({ position: { x: 40, y: 10 } }); await settle() }
const hide = async () => { await page.locator('.editor-phone-toolbar [aria-label="Hide keyboard"]').tap(); await settle() }
try {
  await page.goto(base, { waitUntil: 'networkidle' })
  const later = page.getByRole('button', { name: 'Later', exact: true })
  if (await later.count()) await later.tap()
  const events = await lineAfter('Events'), notes = await lineAfter('Notes')
  const seen = []
  for (const time of ['first', 'second', 'third']) {
    await tapLine(events)
    const v = await visible()
    assert.equal(v.keyboard, KEYBOARD, `${time} focus: the fake keyboard is up`)
    aboveKeyboard(v, `${time} focus`)
    seen.push(v.toolbar.bottom)
    await hide()
    const down = await visible()
    assert.equal(down.keyboard, 0); assert.equal(down.toolbar, null, `${time}: toolbar goes with the keyboard`)
  }
  await tapLine(events)
  await page.keyboard.type('keyboard line')
  await tapLine(notes)
  const moved = await visible()
  aboveKeyboard(moved, 'caret moved to another line, keyboard still up')
  // The Notes line starts behind the keyboard. iOS scrolls the caret to just above the keyboard, where the toolbar sits
  // now, so the app moves the line clear of the toolbar.
  const caretLine = await page.evaluate(() => Math.round(getSelection().anchorNode.parentElement.closest('.bn-block-content').getBoundingClientRect().bottom))
  assert.ok(caretLine <= moved.toolbar.top, `the caret's line is clear of the toolbar (line ${caretLine}, toolbar ${moved.toolbar.top})`)
  await page.evaluate(() => window.__scrollVisual(180)); await settle()
  const scrolled = await visible()
  aboveKeyboard(scrolled, 'scrolled 180 px')
  // Scrolled as far as iOS allows (the visible bottom meets the page's bottom): the keyboard is still up.
  await page.evaluate(k => window.__scrollVisual(k), KEYBOARD); await settle()
  aboveKeyboard(await visible(), `scrolled ${KEYBOARD} px`)
  await page.evaluate(() => window.__scrollVisual(180)); await settle()
  await page.locator('.editor-phone-toolbar .editor-aa').tap(); await settle()
  const panel = await visible()
  assert.ok(panel.panel && panel.panel.bottom <= panel.toolbar.top && panel.panel.top >= panel.top, `Aa panel above the toolbar and visible ${JSON.stringify(panel)}`)
  await page.evaluate(() => window.__scrollVisual(60)); await settle()
  const panelScrolled = await visible()
  aboveKeyboard(panelScrolled, 'scrolled with Aa open')
  assert.ok(panelScrolled.panel && panelScrolled.panel.bottom <= panelScrolled.toolbar.top && panelScrolled.panel.top >= panelScrolled.top, `Aa panel follows a scroll ${JSON.stringify(panelScrolled)}`)
  await page.locator('.editor-phone-toolbar .editor-aa').tap(); await settle()
  await page.evaluate(() => window.__scrollVisual(0)); await settle()
  await page.evaluate(v => { const dt = new DataTransfer(); dt.setData('text/plain', v); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, 'https://example.com/b48-keyboard')
  await settle()
  const menu = await visible()
  assert.ok(menu.menu, 'paste menu shown')
  assert.ok(menu.menu.top >= menu.top && (menu.menu.bottom <= menu.toolbar.top || menu.menu.top >= menu.toolbar.bottom), `paste menu visible and clear of the toolbar ${JSON.stringify(menu)}`)
  besideLine(menu, 'pasted')
  await page.screenshot({ path: `/tmp/jazz-basics/b48-${engine}390${iosRects ? '-ios' : ''}.png` })
  const clear = v => v.menu && v.menu.top >= v.top && v.menu.bottom <= v.bottom && (v.menu.bottom <= v.toolbar.top || v.menu.top >= v.toolbar.bottom)
  for (const y of [120, 40]) {
    await page.evaluate(y => window.__scrollVisual(y), y); await settle()
    const v = await visible()
    aboveKeyboard(v, `scrolled ${y} with the paste menu open`)
    assert.ok(clear(v), `paste menu follows a scroll to ${y} ${JSON.stringify(v)}`)
    if (v.line && v.line.top >= v.top && v.line.bottom <= (v.toolbar?.top ?? v.bottom)) besideLine(v, `scrolled ${y}`)
  }
  await page.keyboard.press('Escape'); await hide()
  // No keyboard (an external one, or the fake turned off): the toolbar keeps its place above the tab bar.
  const plain = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  await plain.goto(base, { waitUntil: 'networkidle' })
  if (await plain.getByRole('button', { name: 'Later', exact: true }).count()) await plain.getByRole('button', { name: 'Later', exact: true }).tap()
  await plain.locator(`[data-node-type="blockContainer"][data-id="${events}"] [data-content-type]`).first().tap({ position: { x: 40, y: 10 } }); await plain.waitForTimeout(350)
  const bottom = await plain.evaluate(() => Math.round(window.innerHeight - document.querySelector('.editor-phone-toolbar').getBoundingClientRect().bottom))
  assert.equal(bottom, 90, 'no keyboard: 90 px above the bottom, over the tab bar')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ engine, keyboard: KEYBOARD, toolbarBottom: seen, visibleBottom: 844 - KEYBOARD, scrolled: scrolled.toolbar, caretLineBottom: caretLine, panel: panel.panel, pasteMenu: menu.menu, noKeyboardBottom: bottom, pageErrors: 0 }))
} finally {
  await browser.close()
}
