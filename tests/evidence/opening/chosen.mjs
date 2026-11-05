// A block chosen by its handle is drawn as chosen, whatever it holds (Bumblebee, after B88): tinted and outlined, moving to the next one chosen, gone when let go, and a block no one chose isn't drawn.
// Usage: node tests/evidence/opening/chosen.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server uses, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/opening/chosen.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/opening/seed.ts ${S}`, { stdio: 'ignore' })
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const open = async (page, { width = 1280, scheme = 'light' } = {}) => { const c = await browser.newContext({ viewport: { width, height: 700 }, colorScheme: scheme, serviceWorkers: 'block' }), p = await c.newPage(), errors = []; p.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) }); await p.goto(`${base}/pages?page=${page}`); await p.waitForTimeout(2200); return { c, p, errors, wait: ms => p.waitForTimeout(ms) } }
const choose = async (p, id, modifiers) => { await p.locator(`.bn-block-outer[data-id="${id}"]`).first().hover(); await p.waitForTimeout(250); await p.locator('.bn-side-menu [aria-label^="Select or drag"]').first().click(modifiers ? { modifiers } : {}); await p.waitForTimeout(350) }
const look = (p, id) => p.evaluate(id => { const e = document.querySelector(`.bn-block-outer[data-id="${id}"]`), s = getComputedStyle(e, '::after'), box = e.getBoundingClientRect(); return { drawn: s.content !== 'none' && s.content !== 'normal' && s.backgroundColor !== 'rgba(0, 0, 0, 0)', ring: s.boxShadow !== 'none', events: s.pointerEvents, height: Math.round(box.height) } }, id)
for (const [page, id, kind] of [['bdb', 'bdb-b', 'a table'], ['bcard', 'bcard-b', 'a card'], ['bsynced', 'bsynced-1', 'a line in a synced block'], ['bdivider', 'bdivider-b', 'a divider'], ['endsline', 'l-below', 'a line']]) {
  const { c, p, errors } = await open(page)
  const before = await look(p, id)
  check(!before.drawn, `${kind}: drawn as nothing until it's chosen`, before)
  await choose(p, id); await p.mouse.move(2, 2); await p.waitForTimeout(200)
  const after = await look(p, id)
  check(after.drawn && after.ring && after.events === 'none', `${kind}: chosen, it's tinted and outlined, and clicks go through`, after)
  check(await p.locator('.continuous-editor.has-selection').count() === 1, `${kind}: and the bar says so`)
  if (shots) await p.screenshot({ path: `${shots}/${engine}-${page}.png` })
  check(errors.length === 0, `${kind}: no page errors`, errors)
  await c.close()
}
// Letting go, moving on, several, keys.
{ const { c, p, errors, wait } = await open('bdb')
  await choose(p, 'bdb-a'); check((await look(p, 'bdb-a')).ring, 'a line chosen')
  await choose(p, 'bdb-z')
  check((await look(p, 'bdb-z')).ring && !(await look(p, 'bdb-a')).drawn, 'choosing another moves it, with the same words in the bar')
  await choose(p, 'bdb-a')
  await choose(p, 'bdb-z', ['Shift'])
  const [a, m, z] = [await look(p, 'bdb-a'), await look(p, 'bdb-b'), await look(p, 'bdb-z')]
  check(a.drawn && m.drawn && z.drawn && !a.ring && !m.ring && !z.ring, 'several: a tint over each, with no box round each', [a, m, z])
  if (shots) await p.screenshot({ path: `${shots}/${engine}-several.png` })
  await p.keyboard.press('Escape'); await wait(300)
  check(!(await look(p, 'bdb-a')).drawn && !(await look(p, 'bdb-b')).drawn, 'Esc lets go')
  await choose(p, 'bdb-a'); await p.locator('.bn-block-outer[data-id="bdb-z"] .bn-inline-content').click(); await wait(300)
  check(!(await look(p, 'bdb-a')).drawn && await p.locator('.continuous-editor.has-selection').count() === 0, 'a click elsewhere lets go')
  await choose(p, 'bdb-a'); await p.keyboard.press('ArrowDown'); await wait(300)
  check(!(await look(p, 'bdb-a')).drawn, 'an arrow lets go')
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }
// Esc from the table chooses it, and it's drawn; opening a page holding only a database doesn't.
{ const { c, p, errors, wait } = await open('alone')
  check(!(await look(p, 'alone-b')).drawn && await p.evaluate(() => getComputedStyle(document.querySelector('.ProseMirror-selectednode > *') ?? document.body, '::after').content) === 'none', 'opening a page holding only a database draws nothing')
  await p.locator('.database-block [contenteditable], .database-block .database-title, .database-block input').first().click(); await wait(250)
  await p.keyboard.press('Escape'); await wait(400)
  check((await look(p, 'alone-b')).ring, 'Esc from the table draws it as chosen')
  await p.keyboard.press('Backspace'); await wait(1400)
  check(await p.locator('.bn-block-outer[data-id="alone-b"]').count() === 0, 'and Backspace removes it, with nothing left drawn')
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }
{ const { c, p } = await open('bdb', { scheme: 'dark' })
  await choose(p, 'bdb-b'); await p.mouse.move(2, 2); await p.waitForTimeout(200)
  check((await look(p, 'bdb-b')).ring, 'dark: drawn too')
  if (shots) await p.screenshot({ path: `${shots}/${engine}-dark.png` })
  await c.close() }
{ const { c, p } = await open('bdb', { width: 390 })
  check(!(await look(p, 'bdb-b')).drawn, '390: drawn as nothing until chosen')
  await c.close() }
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
