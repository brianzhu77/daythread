// B4 (F13): the / menu lists Body (not Paragraph) and Separator, keeps every item (no cut; it scrolls at about 8
// rows), ↑/↓ keeps the highlighted item in view, Separator inserts a divider, aliases find the renamed items, and the
// toolbar's line-type menu and the phone's Aa panel say Body. On the phone, the + menu stays above the keyboard and
// its toolbar, and its last item can be reached. The keyboard is faked as in tests/evidence/b54 (B48).
// Built server on a disposable store copy: node tests/evidence/b4/slash-menu.mjs <base>
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const [base] = process.argv.slice(2)
if (!base || new URL(base).port === '3000') throw Error('Use a disposable loopback server')
const KEYBOARD = 336
const expected = ['Task', 'Page', 'Link to page', 'Bullet List', 'Heading 2', 'Heading 1', 'Heading 3', 'Quote', 'Numbered List', 'Body', 'Separator']
let failed = 0
const ok = (v, what, detail = '') => { if (!v) failed++; console.log(`${v ? 'PASS' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`) }
const menu = p => p.evaluate(() => {
  const m = document.querySelector('#bn-suggestion-menu'); if (!m) return null
  const box = m.getBoundingClientRect(), opts = [...m.querySelectorAll('[role=option]')]
  const title = o => o.querySelector('.flex-1 div, .flex-1')?.firstChild?.textContent?.trim() ?? o.textContent.trim()
  const sel = opts.find(o => o.getAttribute('aria-selected') === 'true')
  const sr = sel?.getBoundingClientRect()
  return { titles: opts.map(title), top: box.top, bottom: box.bottom, height: box.height, scrolls: m.scrollHeight > m.clientHeight + 1,
    selected: sel ? title(sel) : null, selectedInView: sr ? sr.top >= box.top - 1 && sr.bottom <= box.bottom + 1 : false }
})
const blocks = p => p.evaluate(() => document.querySelectorAll('.continuous-editor [data-content-type=divider]').length)

for (const [name, br, w, h, phone] of [['chromium 1280', chromium, 1280, 900, false], ['webkit 390', webkit, 390, 844, true]]) {
  const b = await br.launch(); const p = await b.newPage({ viewport: { width: w, height: h }, ...(phone ? { isMobile: true, hasTouch: true } : {}) })
  const errors = []; p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  if (phone) await p.addInitScript(keyboard => {
    const vv = window.visualViewport; let up = 0
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - up })
    const fire = () => vv.dispatchEvent(new Event('resize'))
    const typing = () => Boolean(document.activeElement?.closest('[contenteditable="true"], input, textarea'))
    document.addEventListener('focusin', () => setTimeout(() => { if (typing() && !up) { up = keyboard; fire() } }, 60))
    document.addEventListener('focusout', () => setTimeout(() => { if (!typing() && up) { up = 0; fire() } }, 60))
  }, KEYBOARD)
  await p.goto(`${base}/`); await p.locator('.continuous-editor .bn-block-outer').first().waitFor(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(800)
  // A fresh empty line under the page's first line.
  const first = p.locator('.continuous-editor .bn-block-outer .bn-inline-content').first()
  if (phone) await first.tap(); else await first.click()
  await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.press('Enter'); await p.waitForTimeout(300)
  const dividers = await blocks(p)
  if (phone) await p.getByRole('button', { name: 'Insert block' }).tap(); else await p.keyboard.type('/')
  await p.waitForTimeout(500)
  let m = await menu(p)
  ok(m && JSON.stringify(m.titles) === JSON.stringify(expected), `${name}: every item, in order, Body and Separator, no Paragraph`, m?.titles.join(', '))
  ok(m && m.height <= 470 && m.scrolls, `${name}: about 8 rows high and scrolls for the rest`, m && `${Math.round(m.height)}px`)
  if (phone) {
    const bar = await p.evaluate(() => document.querySelector('.editor-phone-toolbar')?.getBoundingClientRect().top)
    ok(m && bar && m.bottom <= bar + 1 && m.top >= 0, `${name}: with the keyboard up the + menu sits above the toolbar and keyboard`, m && `menu ${Math.round(m.top)}-${Math.round(m.bottom)}, toolbar top ${Math.round(bar)}`)
    await p.evaluate(() => { const l = document.querySelector('#bn-suggestion-menu'); l.scrollTop = l.scrollHeight }); await p.waitForTimeout(200)
    const last = await p.evaluate(() => { const l = document.querySelector('#bn-suggestion-menu'); const o = [...l.querySelectorAll('[role=option]')].at(-1).getBoundingClientRect(), r = l.getBoundingClientRect(); return o.top >= r.top - 1 && o.bottom <= r.bottom + 1 })
    ok(last, `${name}: scrolled to the end, Separator shows inside the menu`)
    await p.locator('#bn-suggestion-menu [role=option]').last().tap()
  } else {
    for (let i = 0; i < expected.length - 1; i++) await p.keyboard.press('ArrowDown')
    await p.waitForTimeout(200); m = await menu(p)
    ok(m?.selected === 'Separator' && m.selectedInView, `${name}: ↓ past the 8th row scrolls the highlighted item into view`, m && `${m.selected}, in view ${m.selectedInView}`)
    for (let i = 0; i < expected.length - 1; i++) await p.keyboard.press('ArrowUp')
    await p.waitForTimeout(200); m = await menu(p)
    ok(m?.selected === 'Task' && m.selectedInView, `${name}: ↑ back to the top scrolls Task into view`, m?.selected)
    for (let i = 0; i < expected.length - 1; i++) await p.keyboard.press('ArrowDown')
    await p.keyboard.press('Enter')
  }
  await p.waitForTimeout(400)
  ok(await blocks(p) === dividers + 1, `${name}: Separator inserts a divider`)
  ok(!(await p.evaluate(() => [...document.querySelectorAll('.continuous-editor .bn-inline-content')].some(e => e.textContent === '/'))), `${name}: no "/" left behind`)
  ok(!(await menu(p)), `${name}: the menu closes`)
  // Aliases (typed after a /), on a new line.
  if (!phone) {
    for (const [q, want] of [['hr', 'Separator'], ['---', 'Separator'], ['text', 'Body'], ['body', 'Body'], ['p', 'Body'], ['quo', 'Quote']]) {
      await p.keyboard.press('Enter'); await p.keyboard.type('/'); await p.waitForTimeout(150); await p.keyboard.type(q); await p.waitForTimeout(300)
      m = await menu(p); ok(m?.titles.includes(want), `${name}: "/${q}" finds ${want}`, m?.titles.join(', '))
      await p.keyboard.press('Escape'); for (let i = 0; i <= q.length; i++) await p.keyboard.press('Backspace')
    }
    await p.keyboard.press('Enter'); await p.keyboard.type('/'); await p.waitForTimeout(150); await p.keyboard.insertText('分隔'); await p.waitForTimeout(300)
    m = await menu(p); ok(m?.titles.includes('Separator'), `${name}: "/分隔" finds Separator`, m?.titles.join(', '))
    await p.keyboard.press('Escape'); for (let i = 0; i < 3; i++) await p.keyboard.press('Backspace')
    // The toolbar's line-type menu names a plain line Body.
    await p.keyboard.type('hello body'); await p.locator('.continuous-editor .bn-inline-content', { hasText: /^hello body$/ }).click({ clickCount: 3 }); await p.waitForTimeout(500)
    const sel = await p.evaluate(() => document.querySelector('.bn-formatting-toolbar [data-slot=select-value]')?.textContent?.trim())
    ok(sel === 'Body', `${name}: the toolbar's line-type menu says Body`, sel)
  } else {
    await p.locator('.continuous-editor .bn-block-outer .bn-inline-content').first().tap(); await p.waitForTimeout(300)
    await p.getByRole('button', { name: 'Line style' }).tap(); await p.waitForTimeout(300)
    const aa = await p.evaluate(() => [...document.querySelectorAll('.editor-style-panel button')].map(b => b.textContent.trim()))
    ok(aa[0] === 'Body' && !aa.includes('Text'), `${name}: the Aa panel says Body`, aa.join(', '))
  }
  if (phone) {
    // The caret line just above the toolbar, where iOS leaves it after a tap low on the screen: the menu opens above
    // it, taller, and still clear of the toolbar.
    await p.evaluate(() => document.activeElement?.blur?.()); await p.waitForTimeout(300)
    const low = p.locator('.continuous-editor .bn-block-outer .bn-inline-content').nth(8)
    await low.evaluate(e => { const r = e.getBoundingClientRect(); window.scrollBy(0, r.top - 380) }); await p.waitForTimeout(200)
    await low.tap(); await p.waitForTimeout(400)
    await p.getByRole('button', { name: 'Insert block' }).tap(); await p.waitForTimeout(500)
    const caret = await p.evaluate(() => getSelection().getRangeAt(0).getBoundingClientRect().top)
    m = await menu(p)
    const bar = await p.evaluate(() => document.querySelector('.editor-phone-toolbar')?.getBoundingClientRect().top)
    ok(m && m.bottom <= caret && m.top >= 0 && m.bottom <= bar && m.height >= 250, `${name}: from a low line, the + menu opens above it, taller`, m && `menu ${Math.round(m.top)}-${Math.round(m.bottom)}, caret ${Math.round(caret)}, toolbar ${Math.round(bar)}`)
    await p.keyboard.press('Escape')
  }
  ok(errors.length === 0, `${name}: no page errors`, errors.join(' | '))
  await b.close()
}
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0)
