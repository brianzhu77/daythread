// B86's reference gaps in the built app: a one-way relation and a linked view show on their target, a two-way relation and a home block don't, a source in Trash comes last and doesn't open.
// Usage: node tests/evidence/references/gaps.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/references/gaps.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && TZ=America/Vancouver node --no-warnings tests/evidence/references/seed.ts ${storePath} && node --no-warnings tests/evidence/references/seed-gaps.ts ${storePath}`, { stdio: 'ignore' })
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
for (const [width, height] of [[1280, 800], [390, 844]]) {
  const page = await (await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' })).newPage()
  const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
  const wait = ms => page.waitForTimeout(ms), say = what => `${width}: ${what}`
  const go = async path => { await page.goto(base + path); await wait(1900) }
  const line = page.locator('.linked-from')
  const linked = async () => (await line.first().innerText({ timeout: 300 }).catch(() => '')).replace(/\s+/g, ' ').trim()
  const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
  await go('/pages?page=ann')
  check((await linked()).includes('Something else'), say('a one-way relation shows its row on the target'), await linked())
  await shot('one-way')
  await line.getByRole('link', { name: 'Something else' }).click(); await wait(1300)
  check(page.url().includes('page=other'), say('and it opens that row'), page.url())
  await go('/pages?page=ben')
  check(await line.count() === 0 && (await page.locator('.doc-screen').first().innerText()).includes('Something else'), say('a two-way relation doesn\'t: the target\'s own property names it'), await linked())
  await go('/pages?page=work')
  check((await linked()).includes('Weekly plan') && !(await linked()).includes('Projects'), say('a linked view shows its page on the database, and the home isn\'t listed'), await linked())
  await shot('linked-view')
  await go('/pages?page=target')
  const first = await linked()
  check(!first.includes('In the bin') && first.includes('2 more'), say('a source in Trash doesn\'t take one of the first three places'), first)
  await line.getByRole('button', { name: /more/ }).click(); await wait(300)
  const all = await line.first().locator('a, .linked-from-removed').allInnerTexts()
  check(all.at(-1) === 'In the bin (removed)' && all.length === 5, say('it comes last, reading (removed)'), all)
  check(await line.getByRole('link', { name: /In the bin/ }).count() === 0, say('and doesn\'t open'))
  await shot('trash-last')
  await go('/pages?page=quiet')
  check(await line.count() === 0, say('a page with no references has no line'))
  check(errors.length === 0, say('no page errors'), errors)
  await page.context().close()
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
