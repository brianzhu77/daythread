// peek.md §4: a synced block open on both the row in a peek and the page behind it, which is two places in one tab. Nothing typed in either may be lost.
// Usage: node tests/evidence/peek/synced.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/peek/synced.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/peek/seed-synced.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const record = () => JSON.stringify(store().synced ?? [])
const browser = await pw[engine].launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const peek = page.locator('.peek'), shown = scope => scope.locator('.bn-inline-content', { hasText: 'Shared' }).first()
const typeAtEnd = async (where, words) => { const l = shown(where); await l.click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.type(words); await wait(1500) }
const behind = page.locator('.doc-screen').first()
const notices = async () => (await page.locator('[role=alert], [role=status]').allInnerTexts()).join(' | ')

await page.goto(`${base}/pages?page=books`); await wait(2500)
await page.locator('tr[data-row="dune"]').hover(); await page.locator('tr[data-row="dune"] .database-open').click(); await wait(1500)
check(await peek.count() === 1 && await shown(peek).count() === 1 && await shown(behind).count() === 1, 'the block shows in both places')
await typeAtEnd(peek, ' from the peek')
check(record().includes('from the peek'), 'typing in the peek reaches the record', record().slice(0, 160))
check((await shown(behind).innerText()).includes('from the peek'), 'and the place behind follows')
await page.keyboard.press('Escape'); await wait(1200); if (await peek.count()) { await page.keyboard.press('Escape'); await wait(1200) }
check(await peek.count() === 0, 'it closes')
await typeAtEnd(behind, ' then behind')
check(record().includes('from the peek') && record().includes('then behind'), 'typing behind it after keeps both', record().slice(0, 200))
await page.reload(); await wait(2500)
check((await shown(behind).innerText()).includes('from the peek then behind'), 'and a reload shows both')
check(!/changed elsewhere|Changed on/i.test(await notices()), 'with no conflict')
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
