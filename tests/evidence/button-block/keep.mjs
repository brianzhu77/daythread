// A button block at the floor (buttons.md §5): a page holding one opens, draws its label, keeps it whole through typing and a reload, a tap on it does nothing, and it's drawn at 390.
// Usage: node tests/evidence/button-block/keep.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/button-block/keep.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/button-block/seed.ts ${S}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const doc = () => JSON.parse(store().pages.find(p => p.id === 'notes').document)
const buttons = () => doc().filter(n => n.type === 'button')
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
const wait = ms => page.waitForTimeout(ms)
await page.goto(`${base}/pages?page=notes`); await wait(2500)
check(await page.locator('.bn-editor').count() === 1 && await page.locator('body').innerText().then(t => !/Something went wrong/.test(t)), 'a page holding one opens')
check((await page.locator('.editor-button').allInnerTexts()).join('|') === 'Log a run|Button', 'its label draws, or a plain word with none', await page.locator('.editor-button').allInnerTexts())
const before = JSON.stringify(buttons()), rev = store().revision
await page.locator('.editor-button').first().click(); await wait(800)
check(store().revision === rev && JSON.stringify(buttons()) === before, 'a tap changes nothing')
const end = page.locator('.bn-inline-content', { hasText: 'After it' }).first(), b = await end.evaluate(n => { const t = document.createRange(); t.selectNodeContents(n); const x = t.getBoundingClientRect(); return { x: x.right, y: x.top + x.height / 2 } })
await page.mouse.click(b.x + 4, b.y); await wait(150); await page.keyboard.type(' typed'); await wait(2500)
check(doc().some(n => JSON.stringify(n).includes('After it typed')), 'typing beside it saves')
check(JSON.stringify(buttons()) === before, 'and both are kept whole', buttons().map(x => x.props.steps))
await page.reload(); await wait(2500); check(await page.locator('.editor-button').count() === 2, 'a reload draws them')
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' }), p = await phone.newPage(); await p.goto(`${base}/pages?page=notes`); await p.waitForTimeout(2500)
check(await p.locator('.editor-button').count() === 2 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390: drawn, no sideways scroll'); await phone.close()
check(errors.length === 0, 'no page errors', errors.slice(0, 3))
console.log(`[button-block ${engine}] fail ${fails}`)
await browser.close(); process.exit(fails ? 1 : 0)
