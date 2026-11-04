// R4-7: Export from a view's menu: this view, the whole database, and with bodies, read back from the downloaded file.
// Usage: node tests/evidence/csv/export.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/csv/export.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const scenario = async (name, act, options = { viewport: { width: 1280, height: 900 } }) => {
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/csv/seed.ts ${storePath}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, acceptDownloads: true })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=books`); await wait(2200); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
const menu = page => page.locator('.database-menu')
const openExport = async page => { await page.locator('.database-more-button').first().click(); await wait(250); await menu(page).getByRole('menuitem', { name: 'Export' }).click(); await wait(200) }
const take = async (page, name) => {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), menu(page).getByRole('menuitem', { name }).click()])
  return { file: download.suggestedFilename(), bytes: readFileSync(await download.path()) }
}
await scenario('This view: its filter and its visible columns, with a byte order mark', async page => {
  await openExport(page)
  const { file, bytes } = await take(page, 'This view'), text = bytes.toString('utf8')
  const r = { file, text, bom: text.charCodeAt(0) === 0xfeff }
  r.ok = /^Books - .*\.csv$/.test(file) && r.bom && text.includes('Name,Pages,Notes') && text.includes('"沙丘, Dune",412,"two\nlines, ""quoted"""') && !text.includes('Emma') && !text.includes('Short') && !text.includes('Yes')
  return r
})
await scenario('Whole database: every row and property, a number plain, formula-looking text defused', async page => {
  await openExport(page)
  const { file, bytes } = await take(page, 'Whole database'), text = bytes.toString('utf8')
  const r = { file, text }
  r.ok = file === 'Books.csv' && text.includes('Name,Pages,Read,Owned,Notes,Tags') && text.includes('2026-01-02 → 2026-01-09') && text.includes('Yes') && text.includes('SF, History') && text.includes(`Emma,-5,,No,"'=HYPERLINK(""http://x"")"`)
  return r
})
await scenario('With bodies: a zip of the CSV and a Markdown file per row', async page => {
  await openExport(page)
  await menu(page).getByLabel('Include page bodies').check()
  const { file, bytes } = await take(page, 'Whole database')
  const files = unzipSync(new Uint8Array(bytes)), names = Object.keys(files).sort()
  const r = { file, names, dune: strFromU8(files[names.find(n => n.includes('Dune'))] ?? new Uint8Array()).slice(0, 200) }
  r.ok = file === 'Books.zip' && names.includes('Books.csv') && names.filter(n => n.endsWith('.md')).length === 3 && /A body for Dune/.test(r.dune)
  return r
})
await scenario('390: the sheet has it, and the file comes', async page => {
  await openExport(page)
  const box = await menu(page).boundingBox()
  const { file } = await take(page, 'Whole database')
  return { file, box, ok: file === 'Books.csv' && box.x === 0 }
}, { viewport: { width: 390, height: 780 }, hasTouch: true })
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
