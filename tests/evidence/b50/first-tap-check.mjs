// B50: on a touch screen nothing appears when a tap's synthetic mousemove crosses a line (iOS would treat the tap as
// a hover and drop the click); the line handle follows the caret only. A mouse keeps the hover ⋮⋮ handle.
// Playwright's iPhone profile reports (hover: none), as Mobile Safari does. Built server, sign-in off, fresh store:
//   node tests/evidence/b50/first-tap-check.mjs <base>
import { webkit, chromium, devices } from '@playwright/test'
const [base] = process.argv.slice(2)
if (!base || new URL(base).hostname !== '127.0.0.1' || new URL(base).port === '3000') throw Error('Use a disposable loopback server')
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`) }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })

{
  const browser = await webkit.launch(), context = await browser.newContext({ ...devices['iPhone 13'] }), p = await context.newPage()
  const errors = []; p.on('pageerror', e => errors.push(e.message))
  await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  log(await p.evaluate(() => matchMedia('(hover: none)').matches), 'iPhone profile: (hover: none), as on the phone')
  // What iOS does first on a tap: mouseover/mousemove at the point. Nothing may appear.
  const appeared = await p.evaluate(async () => {
    const seen = []; const mo = new MutationObserver(rs => rs.forEach(r => r.addedNodes.forEach(n => n.nodeType === 1 && seen.push(n.className || n.nodeName))))
    mo.observe(document.body, { subtree: true, childList: true })
    const line = [...document.querySelectorAll('.bn-editor .bn-inline-content')][3], r = line.getBoundingClientRect()
    for (const type of ['mouseover', 'mouseenter', 'mousemove']) line.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: r.left + 10, clientY: r.top + 5 }))
    await new Promise(res => setTimeout(res, 400)); mo.disconnect()
    return { seen: [...new Set(seen.map(String))], sideMenus: document.querySelectorAll('.bn-side-menu').length }
  })
  log(appeared.sideMenus === 0 && !appeared.seen.length, 'a hover over a line makes nothing appear (no ⋮⋮ side menu)', JSON.stringify(appeared))
  // A link: its toolbar opens on mouseover too. Paste one (kept as a plain link), leave the line, then hover it.
  const notes0 = p.locator(`.bn-block-outer[data-id="day:${today}:notes:template:0"] .bn-inline-content`).first()
  await notes0.tap()
  await p.evaluate(v => { const dt = new DataTransfer(); dt.setData('text/plain', v); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, 'https://example.com/b50')
  await p.waitForTimeout(400); await p.keyboard.press('Escape'); await p.waitForTimeout(400)
  // Put the caret elsewhere first (a selection inside the link opens its toolbar by itself, rightly).
  await p.locator('.bn-inline-content', { hasText: 'Notes' }).first().tap(); await p.waitForTimeout(300)
  const linkHover = await p.evaluate(async () => {
    const before = document.querySelectorAll('.bn-link-toolbar').length
    if (before) return `toolbar already open before the hover (${before})`
    const a = document.querySelector('.bn-editor a[href="https://example.com/b50"]'), r = a.getBoundingClientRect()
    for (const type of ['mouseover', 'mousemove']) a.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: r.left + 4, clientY: r.top + 4 }))
    await new Promise(res => setTimeout(res, 500))
    return document.querySelectorAll('.bn-link-toolbar').length
  })
  log(linkHover === 0, 'a hover over a link opens no link toolbar', String(linkHover))
  await p.evaluate(() => document.activeElement.blur())
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  const handleAt = () => p.evaluate(() => { const h = document.querySelector('.editor-touch-handle'), s = getSelection(), a = s?.anchorNode, e = a && (a.nodeType === 1 ? a : a.parentElement), row = e?.closest('[data-node-type="blockContainer"]')
    const hr = h && getComputedStyle(h).display !== 'none' ? h.getBoundingClientRect() : null, rr = row?.querySelector('.bn-block-content')?.getBoundingClientRect()
    return { shown: Boolean(hr), handleMid: hr ? Math.round(hr.top + hr.height / 2) : null, line: rr ? [Math.round(rr.top), Math.round(rr.bottom)] : null, id: row?.dataset.id } })
  log(!(await handleAt()).shown, 'no caret: no handle')
  const notes = p.locator(`.bn-block-outer[data-id="day:${today}:notes:template:0"] .bn-inline-content`).first()
  await notes.tap(); await p.keyboard.press('End'); await p.keyboard.press('Enter'); await p.keyboard.type('first line'); await p.keyboard.press('Enter'); await p.keyboard.type('second line'); await p.waitForTimeout(400)
  let h = await handleAt()
  log(h.shown && h.handleMid >= h.line[0] && h.handleMid <= h.line[1], 'the handle sits beside the caret\'s line', JSON.stringify(h))
  await p.locator('.bn-inline-content', { hasText: 'first line' }).first().tap(); await p.waitForTimeout(400)
  const h2 = await handleAt()
  log(h2.shown && h2.id !== h.id && h2.handleMid >= h2.line[0] && h2.handleMid <= h2.line[1], 'the caret moves up a line: the handle moves with it', JSON.stringify(h2))
  // The visible part moving (iOS keyboard) without a window scroll: the handle follows on visualViewport events.
  await p.evaluate(() => { document.querySelector('.bn-editor').style.marginTop = '120px'; visualViewport.dispatchEvent(new Event('resize')) }); await p.waitForTimeout(300)
  const h3 = await handleAt()
  log(h3.shown && h3.handleMid >= h3.line[0] && h3.handleMid <= h3.line[1], 'the line moves without a window scroll: the handle follows it', JSON.stringify(h3))
  await p.evaluate(() => { document.querySelector('.bn-editor').style.marginTop = ''; document.activeElement.blur() }); await p.waitForTimeout(300)
  log(!(await handleAt()).shown, 'editing ends: no handle')
  log(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' / '))
  await browser.close()
}
{
  const browser = await chromium.launch(), p = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  const box = await p.locator('.bn-editor .bn-inline-content').nth(3).boundingBox()
  await p.mouse.move(box.x + 10, box.y + 5); await p.waitForTimeout(400)
  log(await p.locator('.bn-side-menu').count() === 1, 'desktop: the hover ⋮⋮ handle still shows')
  await browser.close()
}
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
