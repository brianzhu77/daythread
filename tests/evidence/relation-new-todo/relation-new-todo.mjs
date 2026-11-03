// R3-25 "New to-do" in a relation's pick list, in the built app, on a fresh store: offered only for words that match nothing, made on today's
// page with its link, one Undo for both, unticked it's never made, from a row page too.
// Usage: node tests/evidence/relation-new-todo/relation-new-todo.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> reads, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/relation-new-todo/relation-new-todo.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/relation-new-todo/seed-new-todo.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const row = id => store().pages.find(p => p.id === id)
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const tap = l => wide ? l.click() : l.tap()
const block = page.locator('.database-block').first()
const cell = id => block.locator(`tr.database-row[data-row="${id}"] td.is-relation button.database-cell`)
const search = () => page.locator('input.property-field').first()
const options = () => page.locator('button.property-row[role="option"]')
const done = async () => { if (wide) { await page.mouse.click(5, 5) } else { await page.getByText('Done').last().tap() } await wait(1100) }
const tasks = title => store().tasks.filter(t => t.title === title)

await page.goto(`${base}/pages?page=books`); await wait(2500)
await tap(cell('dune')); await wait(400)
check((await options().allInnerTexts()).every(t => !t.startsWith('New to-do')), 'with no words, no New to-do', await options().allInnerTexts())
await shot('empty')
await search().fill('already here'); await wait(200)
check((await options().allInnerTexts()).every(t => !t.startsWith('New to-do')), 'words that match a to-do offer that to-do', await options().allInnerTexts())
await search().fill('Call the printer'); await wait(200)
check((await options().first().innerText()).replace(/\s+/g, ' ').trim() === 'New to-do: Call the printer', 'words that match none offer it', await options().first().innerText())
await shot('offer')
await tap(options().first()); await wait(300)
check(tasks('Call the printer').length === 0, 'nothing is made yet')
await done()
const made = tasks('Call the printer')[0]
check(Boolean(made), 'closing makes the to-do')
const today = store().pages.find(p => p.type === 'daily' && JSON.stringify(p.document).includes(made?.id ?? 'none'))
check(today?.date === new Date().toLocaleDateString('en-CA'), "its line is on today's page", today?.date)
check(JSON.stringify(row('dune').values?.jobs) === JSON.stringify([`todo:${made?.id}`]) || row('dune').values?.jobs?.[0]?.endsWith(made?.id), 'and the row links it', row('dune').values?.jobs)
check((await block.locator('tr.database-row[data-row="dune"] td.is-relation').innerText()).includes('Call the printer'), 'the cell reads its title')
await shot('made')
const undo = page.getByRole('button', { name: 'Undo' }).first()
check(await page.getByText('To-do added').count() === 1 && await undo.count() === 1, 'it says so, with Undo')
await tap(undo); await wait(1100)
check(tasks('Call the printer').length === 0 && !row('dune').values?.jobs, 'one Undo takes both', row('dune').values)

// Unticked before closing, it's never made. (A multi-select's Esc saves what's picked, as on any way out.)
await tap(cell('emma')); await wait(400)
await search().fill('Never made'); await wait(200); await tap(options().first()); await wait(300)
await tap(options().filter({ hasText: 'Never made' }).first()); await wait(200)
await done()
check(tasks('Never made').length === 0, 'unticked first, it is never made', tasks('Never made').length)

// From a row's page, and alongside one already there.
await page.goto(`${base}/pages?page=ubik`); await wait(2500)
await tap(page.locator('.row-property', { hasText: 'Jobs' }).locator('.row-property-value')); await wait(400)
await search().fill('Already here'); await wait(200); await tap(options().filter({ hasText: 'Already here' }).first()); await wait(200)
await search().fill('From the page'); await wait(200); await tap(options().first()); await wait(200)
await done()
const pair = row('ubik').values?.jobs ?? []
check(pair.length === 2 && tasks('From the page').length === 1 && tasks('Already here').length === 1, 'from a row page, with one picked too', pair)
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
