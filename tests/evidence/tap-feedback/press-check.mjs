// Tap feedback §1.1 (docs/design/tap-feedback.md), the press layer's timing and limits in the built app.
// Usage: node tests/evidence/tap-feedback/press-check.mjs <base-url>   (reads only: every press is cancelled or lands on
// a control that only opens or closes something)
import * as pw from '@playwright/test'
const base = process.argv[2]
if (!base) { console.error('Usage: node tests/evidence/tap-feedback/press-check.mjs <base-url>'); process.exit(2) }
const results = [], ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const pressOf = loc => loc.evaluate(e => e.getAttribute('data-press') === null ? null : `${e.getAttribute('data-press')}${e.hasAttribute('data-press-out') ? ' out' : ''}`)

for (const engine of ['chromium', 'webkit']) {
  const browser = await pw[engine].launch()
  for (const touch of [false, true]) {
    const tag = `${engine} ${touch ? '390 touch' : '1280 mouse'}`
    const context = await browser.newContext(touch ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: engine === 'chromium' } : { viewport: { width: 1280, height: 860 } })
    const page = await context.newPage()
    await page.goto(`${base}/pages`, { waitUntil: 'networkidle' }); await wait(800)
    const control = page.locator(touch ? 'a.tab' : 'a.side-row').first()
    const box = await control.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
    const cdp = engine === 'chromium' && touch ? await context.newCDPSession(page) : null
    const down = async () => cdp ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }) : (await page.mouse.move(x, y), await page.mouse.down())
    const cancel = async () => cdp ? cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }) : (await page.mouse.move(1, 1), await page.mouse.up())
    if (touch && !cdp) { await context.close(); continue } // WebKit has no touch driver here; its mouse run covers the module.

    // Shown in the same frame as the press.
    await down()
    ok(`${tag} press shows at once`, (await pressOf(control)) !== null, String(await pressOf(control)))
    // Moving more than 8 px ends it at once, with no 100 ms minimum.
    if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 20 }] })
    else await page.mouse.move(x, y + 20)
    ok(`${tag} moving 20 px clears it at once`, (await pressOf(control)) === null, String(await pressOf(control)))
    await cancel(); await wait(300)

    // A cancelled press (the browser took the touch for a scroll) clears at once.
    await down(); await cancel()
    ok(`${tag} cancel clears it at once`, (await pressOf(control)) === null, String(await pressOf(control)))
    await wait(300)
    await context.close()
  }

  // A quick click still shows for 100 ms, then fades out over 120 ms; reduced motion has no fade.
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion })
    const page = await context.newPage()
    await page.goto(`${base}/pages`, { waitUntil: 'networkidle' }); await wait(800)
    const t = page.locator('button.side-label-add').first()
    const box = await t.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const seen = await page.evaluate(async () => {
      const el = document.querySelector('button.side-label-add'), at = []
      const look = () => el.getAttribute('data-press') === null ? '-' : el.hasAttribute('data-press-out') ? 'out' : 'on'
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7, pointerType: 'mouse', clientX: 1, clientY: 1 }))
      await new Promise(r => setTimeout(r, 20))
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 7, pointerType: 'mouse', clientX: 1, clientY: 1 }))
      for (const ms of [40, 90, 130, 280]) { await new Promise(r => setTimeout(r, ms - (at.length ? [40, 90, 130, 280][at.length - 1] : 20))); at.push(`${ms}:${look()}`) }
      return at.join(' ')
    })
    const want = reducedMotion === 'reduce' ? /^40:on 90:on 130:- 280:-$/ : /^40:on 90:on 130:out 280:-$/
    ok(`${engine} quick click held 100 ms, ${reducedMotion === 'reduce' ? 'no fade (reduced motion)' : 'then fades'}`, want.test(seen), seen)
    await context.close()
  }

  // His to-do box (Jazz 28eea1ab): a 6 px halo around the native box, and its row tinted; the press is moved off, so nothing ticks.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: 'America/Vancouver' })
    const page = await context.newPage()
    await page.goto(`${base}/`, { waitUntil: 'networkidle' }); await wait(800)
    const box = page.locator('.editor-task input[type=checkbox]').first()
    const b = await box.boundingBox()
    if (!b) ok(`${engine} to-do box on the page`, false, 'none: seed the store with tests/evidence/tap-feedback/seed.ts')
    else {
      const before = await box.isChecked()
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down()
      const look = await box.evaluate(e => ({ press: e.getAttribute('data-press'), outline: getComputedStyle(e).outlineWidth, row: e.closest('.editor-task')?.getAttribute('data-press-row') }))
      await page.mouse.move(b.x + 200, b.y + 200); await page.mouse.up(); await wait(300)
      ok(`${engine} to-do box: halo and row tint while pressed`, look.press === 'box' && look.outline === '6px' && look.row === 'on', JSON.stringify(look))
      ok(`${engine} to-do box: a press moved off doesn't tick it`, (await box.isChecked()) === before)
    }
    await context.close()
  }

  // Keys: Space and Enter press a button; Enter presses a link, Space doesn't (it scrolls).
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
    const page = await context.newPage()
    await page.goto(`${base}/pages`, { waitUntil: 'networkidle' }); await wait(800)
    const keyPress = async (sel, key) => { await wait(300); return page.evaluate(([sel, key]) => {
      const el = document.querySelector(sel); el.focus()
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      const shown = el.getAttribute('data-press') !== null
      el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
      return shown
    }, [sel, key]) }
    ok(`${engine} Space on a button shows`, await keyPress('button.side-label-add', ' '))
    ok(`${engine} Enter on a link shows`, await keyPress('a.side-row', 'Enter'))
    ok(`${engine} Space on a link doesn't`, !(await keyPress('a.side-row', ' ')))
    // Editable text is never pressed.
    const editable = await page.evaluate(() => {
      const d = Object.assign(document.createElement('div'), { contentEditable: 'true', textContent: 'typing' }); d.setAttribute('role', 'button'); document.body.append(d)
      d.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 9, pointerType: 'mouse' }))
      const shown = d.getAttribute('data-press') !== null; d.remove(); return shown
    })
    ok(`${engine} editable text isn't pressed`, !editable)
    // A control inside a draggable block (BlockNote marks the block under the mouse draggable) still gets the press;
    // a grip doesn't (Lead cb75a132, Jazz 41ad161d).
    const inBlock = await page.evaluate(() => {
      const block = Object.assign(document.createElement('div'), { draggable: true }), b = document.createElement('button'), grip = document.createElement('button')
      b.textContent = '+ New'; grip.className = 'database-row-handle'; grip.textContent = '⋮⋮'; block.append(b, grip); document.body.append(block)
      const down = el => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 11, pointerType: 'mouse' }))
      down(b); const pressed = b.getAttribute('data-press') !== null
      window.dispatchEvent(new Event('blur')); down(grip); const gripPressed = grip.getAttribute('data-press') !== null
      window.dispatchEvent(new Event('blur')); block.remove(); return { pressed, gripPressed }
    })
    ok(`${engine} a control in a draggable block is pressed, a grip isn't`, inBlock.pressed && !inBlock.gripPressed, JSON.stringify(inBlock))
    // Window blur clears a held key press.
    const blurred = await page.evaluate(() => {
      const el = document.querySelector('button.side-label-add'); el.focus()
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      window.dispatchEvent(new Event('blur'))
      return el.getAttribute('data-press') === null
    })
    ok(`${engine} window blur clears a press`, blurred)
    await context.close()
  }
  await browser.close()
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
