// Moving lines on a phone (Brian 2026-11-08, line-drag.ts) at 390: a long press anywhere on a line picks it up, with a chip of its
// words and nothing else on the page hidden; it lands where the finger lets go, in or out of a nested line; a heading takes its
// section; a tap still places the caret and a swipe still scrolls; a drag raises no keyboard; one Undo puts it back.
// Chromium sends real touch events (CDP); WebKit gets the same as pointer events, as Playwright can't hold a finger there.
// Usage: node tests/evidence/phone-drag/phone-drag.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/phone-drag/phone-drag.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const order = () => { const flat = l => l.flatMap(n => [n.children?.length ? `${n.id}(${n.children.map(c => c.id).join(' ')})` : n.id]); return flat(JSON.parse(store().pages.find(p => p.id === `day:${today}`).document)).filter(id => !id.startsWith('z')).join(' ') }
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const open = async () => {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/phone-drag/seed.ts ${S} ${today}`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: engine === 'chromium', serviceWorkers: 'block', timezoneId: 'America/Vancouver' })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver/.test(e.message)) errors.push(e.message) })
  await page.goto(`${base}/`); await page.locator('.bn-editor').first().waitFor({ timeout: 30000 }); await wait(2500)
  const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null
  // One finger: down, held, moved in steps, up.
  const finger = async (from, to, holdMs, steps = 12) => {
    if (cdp) {
      const t = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
      await t('touchStart', from.x, from.y); await wait(holdMs)
      for (let i = 1; i <= steps; i++) { await t('touchMove', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await wait(30) }
      await wait(250); await t('touchEnd')
    } else {
      await page.evaluate(async ({ from, to, holdMs, steps }) => {
        const at = (x, y) => document.elementFromPoint(x, y) ?? document.body
        const fire = (type, x, y, el) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }))
        const start = at(from.x, from.y); fire('pointerdown', from.x, from.y, start)
        await new Promise(r => setTimeout(r, holdMs))
        for (let i = 1; i <= steps; i++) { const x = from.x + (to.x - from.x) * i / steps, y = from.y + (to.y - from.y) * i / steps; fire('pointermove', x, y, window); await new Promise(r => setTimeout(r, 30)) }
        await new Promise(r => setTimeout(r, 250)); fire('pointerup', to.x, to.y, window)
      }, { from, to, holdMs, steps })
    }
  }
  return { context, page, errors, finger }
}
const mid = async (page, id, dy = 0) => { const b = await page.locator(`.bn-block-outer[data-id="${id}"] > .bn-block`).first().boundingBox(); return { x: b.x + Math.min(120, b.width / 2), y: b.y + Math.min(b.height, 30) / 2 + dy } }
const edge = async (page, id, which) => { const b = await page.locator(`.bn-block-outer[data-id="${id}"] > .bn-block`).first().boundingBox(); return { x: 200, y: which === 'top' ? b.y + 3 : b.y + Math.min(b.height, 30) - 3 } }

// 1. A hold anywhere on a line picks it up: a chip with its words, the line dimmed, nothing else hidden; it lands where let go.
{
  const { context, page, errors, finger } = await open()
  const shown = () => page.locator('.bn-block-outer').evaluateAll(l => l.filter(e => e.getBoundingClientRect().height > 0).length)
  const before = await shown(), from = await mid(page, 'a2'), to = await edge(page, 'b1', 'bottom')
  const during = (async () => { await wait(850); return { chip: await page.locator('.line-drag-chip').textContent().catch(() => null), held: await page.evaluate(() => document.getElementById('line-held-style')?.textContent.match(/data-id/g)?.length ?? 0), shown: await shown(), line: await page.locator('.editor-drop-line').count() } })()
  await finger(from, to, 550)
  const seen = await during
  if (shots) await page.screenshot({ path: `${shots}/${engine}-after-drop.png` })
  await wait(1800)
  check(seen.chip === 'Alpha two' && seen.held === 1 && seen.line === 1, 'held: a chip with its words, the line dimmed, a drop line', seen)
  check(seen.shown === before, 'and every other line still showing', { before, during: seen.shown })
  check(order() === 'ha a1 a3 hb b1 a2 b2(b21) t1', 'it lands where the finger let go', order())
  check(await page.evaluate(() => !document.activeElement?.isContentEditable), 'and no keyboard comes up')
  await page.getByRole('button', { name: 'Undo' }).first().tap({ timeout: 6000 }).catch(() => page.getByRole('button', { name: 'Undo' }).first().click({ timeout: 3000 }))
  await wait(1800)
  check(order() === 'ha a1 a2 a3 hb b1 b2(b21) t1', 'one Undo puts it back', order())
  check(errors.length === 0, 'no page errors', errors.slice(0, 2)); await context.close()
}
// 2. Up the page, into a nested line, and a to-do; a heading takes its section.
{
  const { context, page, finger } = await open()
  await finger(await mid(page, 't1'), await edge(page, 'a1', 'top'), 550); await wait(1800)
  check(order() === 'ha t1 a1 a2 a3 hb b1 b2(b21)', 'a to-do moves up, above the line it was let go on', order())
  await finger(await mid(page, 'a3'), await edge(page, 'b21', 'top'), 550); await wait(1800)
  check(order() === 'ha t1 a1 a2 hb b1 b2(a3 b21)', 'a line goes in under another, above the line it was let go on', order())
  await finger(await mid(page, 'hb'), await edge(page, 'ha', 'top'), 550); await wait(1800)
  check(order() === 'hb b1 b2(a3 b21) ha t1 a1 a2', 'a heading takes its section', order())
  await context.close()
}
// 3. A tap places the caret and moves nothing; a swipe scrolls and moves nothing.
{
  const { context, page, finger } = await open()
  const p = await mid(page, 'a2'); await page.touchscreen.tap(p.x, p.y); await wait(800)
  check(await page.evaluate(() => Boolean(document.activeElement?.isContentEditable)) && order() === 'ha a1 a2 a3 hb b1 b2(b21) t1' && !(await page.locator('.line-drag-chip').count()), 'a tap places the caret and moves nothing')
  await page.evaluate(() => document.activeElement?.blur()); await wait(400)
  const y0 = await page.evaluate(() => scrollY)
  await finger(await mid(page, 'z6'), await mid(page, 'a1'), 30, 8); await wait(1200)
  check(order() === 'ha a1 a2 a3 hb b1 b2(b21) t1' && !(await page.evaluate(() => document.getElementById('line-held-style'))), 'a swipe moves nothing', { order: order(), scrolled: (await page.evaluate(() => scrollY)) - y0 })
  await context.close()
}
// 4. The grip beside the caret's line: a tap selects the line and moves nothing; a drag on it moves the line, as a hold does.
if (engine === 'chromium') {
  const { context, page, finger } = await open()
  const p = await mid(page, 'a2'); await page.touchscreen.tap(p.x, p.y); await wait(800)
  const grip = await page.locator('.editor-touch-handle').boundingBox()
  const g = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }
  await page.touchscreen.tap(g.x, g.y); await wait(800)
  const selected = await page.locator('.continuous-editor.has-selection').count()
  check(order() === 'ha a1 a2 a3 hb b1 b2(b21) t1' && selected === 1, 'a tap on the grip selects its line, as before, and moves nothing', { order: order(), selected })
  await page.keyboard.press('Escape'); await wait(300); await page.touchscreen.tap(p.x, p.y); await wait(800)
  const to = await edge(page, 'b1', 'bottom')
  await finger(g, { x: g.x, y: to.y }, 60); await wait(1800)
  check(order() === 'ha a1 a3 hb b1 a2 b2(b21) t1', 'a drag on the grip moves its line where let go', order())
  await context.close()
}
console.log(`[phone-drag ${engine}] fail ${fails}`)
await browser.close(); process.exit(fails ? 1 : 0)
