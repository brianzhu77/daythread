// R3-13 on To-dos: a drag to a board's cell with no rows, on the task's own commands, where Status and Planned aren't independent.
// Usage: node tests/evidence/sub-groups/todos-lanes.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> reads, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/sub-groups/todos-lanes.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/sub-groups/seed-todos-lanes.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const browser = await pw[engine].launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const SEP = '\u0001'
const taskOf = title => store().tasks.find(t => t.title === title)
const block = page.locator('.database-block').first()


await page.goto(`${base}/pages?page=books`); await wait(2500)
const card = t => block.locator('[data-card]', { hasText: t })
const cellOf = async t => (await block.locator('.database-column', { has: page.locator('[data-card]', { hasText: t }) }).getAttribute('data-column', { timeout: 3000 })).split(SEP)
const [fromStatus, ownLane] = await cellOf('Water the plants')
const [, otherLane] = await cellOf('Call the bank')
check(fromStatus === 'open' && ownLane !== otherLane, 'two lanes, each to-do in its own', [fromStatus, ownLane, otherLane])
if (shots) await page.screenshot({ path: `${shots}/${engine}-1280-todos-lanes.png`, fullPage: true })
const dragTo = async (title, key) => {
  const c = card(title), to = block.locator(`.database-column[data-column="${key}"]`)
  await c.scrollIntoViewIfNeeded()
  const a = await c.boundingBox(), b = await to.boundingBox()
  await page.mouse.move(a.x + 20, a.y + 10); await page.mouse.down()
  await page.mouse.move(a.x + 28, a.y + 18, { steps: 3 }); await wait(80)
  await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 12 }); await wait(250)
  await page.mouse.up(); await wait(1600)
}
const undo = async times => { for (let i = 0; i < times; i++) { await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1000) } }
const home = ['open', ownLane], same = (a, b) => a?.[0] === b[0] && a?.[1] === b[1]
const refused = () => page.getByText('Reopen it first').count()

// Paused has no day: the status goes alone, and it lands on No date, not in the lane it was dropped in.
const target = `paused${SEP}${otherLane}`
check(await block.locator(`.database-column[data-column="${target}"] [data-card]`).count() === 0, 'the cell has no rows')
await dragTo('Water the plants', target)
let now = await cellOf('Water the plants')
check(taskOf('Water the plants').paused === true && now[0] === 'paused' && now[1] !== otherLane, 'a drop on Paused in a day pauses it, with no day', now)
await undo(1)
check(same(await cellOf('Water the plants'), home), 'one Undo brings it back', await cellOf('Water the plants'))

// Paused to Open in a day: one command, since planning opens it.
await dragTo('Water the plants', target)
const pausedAt = (await cellOf('Water the plants'))[1]
await dragTo('Water the plants', `open${SEP}${otherLane}`)
now = await cellOf('Water the plants')
check(same(now, ['open', otherLane]), 'a paused to-do dropped on Open in a day is open on that day', now)
await undo(1)
check(same(await cellOf('Water the plants'), ['paused', pausedAt]), 'and one Undo takes that back', await cellOf('Water the plants'))
await dragTo('Water the plants', `open${SEP}${otherLane}`)
check(same(await cellOf('Water the plants'), ['open', otherLane]), 'and a drag opens it again', await cellOf('Water the plants'))

// Done stays on its own day: no refusal, and the status is what changes.
await dragTo('Post the letter', `done${SEP}${otherLane}`)
now = await cellOf('Post the letter')
check(taskOf('Post the letter').status === 'done' && now[0] === 'done' && await refused() === 0, 'a drop on Done in a day finishes it, with no refusal', now)
const doneAt = now[1]

// Done to Open in another day: both, in order, so the second reads what the first left: two Undos.
await dragTo('Post the letter', `open${SEP}${otherLane}`)
now = await cellOf('Post the letter')
check(same(now, ['open', otherLane]) && await refused() === 0, 'a finished to-do dropped on Open in a day is reopened on that day', now)
if (shots) await page.screenshot({ path: `${shots}/${engine}-1280-todos-lanes-after.png`, fullPage: true })
// One change now (R4-17, closing #92's exception): one Undo puts it back as it was, finished on its day.
await undo(1)
now = await cellOf('Post the letter')
check(same(now, ['done', doneAt]), 'one Undo takes back both', now)
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
