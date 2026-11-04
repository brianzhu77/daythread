// R4-1 §5: a To-dos Timeline by Start and Deadline: a move is one task command with one Undo, and never takes a line off its day page.
// Usage: node tests/evidence/timeline/todos.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> reads, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/timeline/todos.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/timeline/seed.ts ${storePath} todos`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const task = () => store().tasks.find(t => t.title === 'Water the plants')
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
const lineOnDay = () => store().pages.find(p => p.date === day(0)).document.includes(task().id)
const browser = await pw[engine].launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
await page.goto(`${base}/pages?page=holder`); await wait(2500)
const bar = page.locator('.database-bar', { hasText: 'Water the plants' })
check(await bar.count() === 1 && lineOnDay(), 'a to-do draws from Start to Deadline, with its line on its day')
const b = await bar.boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2
await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 8, y, { steps: 3 }); await wait(60); await page.mouse.move(x + 96, y, { steps: 8 }); await wait(120); await page.mouse.up(); await wait(1200)
check(task().attentionOn === day(3) && task().deadlineOn === day(5), 'a move sets both dates', [task().attentionOn, task().deadlineOn])
check(lineOnDay(), 'and its line stays on its day page')
await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1000)
check(task().attentionOn === day(1) && task().deadlineOn === day(3), 'one Undo takes back both', [task().attentionOn, task().deadlineOn])
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
