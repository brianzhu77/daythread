// B81: a save that failed, the network back, a reload: the draft is saved once, with no conflict line, and it isn't kept.
// On the dev server, React's strict check used to send a second save that was refused and read as "Changed on another device".
// A real leave right after typing is still saved. Chromium only: page.route doesn't see these requests in WebKit.
// Usage: node tests/evidence/b81-reload.mjs <base-url> <store-path>  (a throwaway SQLite file, reseeded)
import { chromium } from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/b81-reload.mjs <base-url> <store-path>'); process.exit(2) }
const [base, storePath] = process.argv.slice(2)
const seed = () => execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const books = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()).pages.find(p => p.id === 'books').document
const browser = await chromium.launch({ headless: true }), out = {}
const open = async () => { const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await context.newPage(); await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500); await page.getByText('After the table').click(); await page.keyboard.press('Meta+ArrowRight'); return { context, page } }
seed()
{
  const { context, page } = await open()
  let posts = 0
  await page.route('**/_serverFn/**', r => r.request().method() === 'POST' ? r.abort() : r.continue())
  await page.keyboard.type(' typed offline'); await page.waitForTimeout(2500)
  await page.unroute('**/_serverFn/**')
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('_serverFn') && (r.postData() ?? '').includes('typed offline')) posts++ })
  await page.reload(); await page.waitForTimeout(5000)
  out.reload = { saved: books().includes('typed offline'), posts, line: (await page.locator('.editor-save-line').innerText()).replace(/\s+/g, ' ') }
  await context.close()
}
seed()
{
  const { context, page } = await open()
  await page.keyboard.type(' left at once')
  await page.getByRole('link', { name: 'Films' }).first().click(); await page.waitForTimeout(2000)
  out.leave = { saved: books().includes('left at once') }
  await context.close()
}
await browser.close()
console.log(JSON.stringify(out))
const ok = out.reload.saved && out.reload.posts === 1 && !/another device|another tab/.test(out.reload.line) && out.leave.saved
console.log(ok ? 'PASS' : 'FAIL'); if (!ok) process.exit(1)
