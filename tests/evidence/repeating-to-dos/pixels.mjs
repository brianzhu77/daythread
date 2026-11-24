// A to-do with no repeat is unchanged, pixel for pixel (repeating-to-dos.md §3, §7 "A to-do with no repeat is unchanged"): the same store, seeded
// with `plain` (no repeat), opened in the build this branch left `main` at and in this branch, and the screenshots compared byte for byte.
// Five pages, two widths, light and dark; then one to-do's ⋯ menu on both, which may differ only by `Repeat…` right under `Blocked by…`.
// Usage: node tests/evidence/repeating-to-dos/pixels.mjs <base-a> <base-b> [shots-dir]
//   <base-a>: a server of the build at the merge base with main; <base-b>: a server of this branch. Each uses its own copy of one store:
//   node --no-warnings tests/evidence/repeating-to-dos/seed.ts <store-a> <today> plain, then copy <store-a> over <store-b> before starting the servers.
import * as pw from '@playwright/test'
import { writeFileSync } from 'node:fs'
const [a, b, shots] = process.argv.slice(2)
if (!a || !b) { console.error('Usage: node tests/evidence/repeating-to-dos/pixels.mjs <base-a> <base-b> [shots-dir]'); process.exit(2) }
const today = new Date().toLocaleDateString('en-CA')
const tomorrow = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw.chromium.launch({ headless: true })
const paths = ['/', `/day/${tomorrow}`, '/tasks', '/tasks?view=upcoming', '/pages?page=notes']
const sizes = [{ width: 1280, height: 900 }, { width: 390, height: 780 }]
let failed = 0
const report = (ok, name, detail = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, detail) }
const open = async (base, path, viewport, colorScheme) => {
  const context = await browser.newContext({ viewport, colorScheme, serviceWorkers: 'block', hasTouch: viewport.width < 600 }), page = await context.newPage()
  await page.goto(`${base}${path}`); await wait(2600)
  return { context, page }
}
const shot = async (base, path, viewport, colorScheme) => {
  const { context, page } = await open(base, path, viewport, colorScheme)
  const buffer = await page.screenshot({ animations: 'disabled', fullPage: true })
  await context.close()
  return buffer
}
for (const viewport of sizes) for (const colorScheme of ['light', 'dark']) for (const path of paths) {
  const name = `${path} at ${viewport.width}, ${colorScheme}`
  const [before, after] = [await shot(a, path, viewport, colorScheme), await shot(b, path, viewport, colorScheme)]
  const same = before.equals(after)
  if (!same && shots) {
    const stem = `${shots}/pixels-${path.replace(/\W+/g, '-')}-${viewport.width}-${colorScheme}`
    writeFileSync(`${stem}-a.png`, before); writeFileSync(`${stem}-b.png`, after)
  }
  report(same, name, same ? `${before.length} bytes` : `a ${before.length} bytes, b ${after.length} bytes${shots ? ' (both written to the shots directory)' : ''}`)
}
// The ⋯ menu of a to-do that doesn't repeat: Repeat… is the only new item, right under Blocked by….
const menuOf = async (base, path, open_) => {
  const { context, page } = await open(base, path, sizes[0], 'light')
  await open_(page); await wait(250)
  const items = await page.getByRole('menuitem').allTextContents()
  await context.close()
  return items
}
const editorMenu = async page => { const r = page.locator('.editor-task', { has: page.locator('.editor-task-title', { hasText: /^Water the plants/ }) }).first(); await r.hover(); await r.locator('.editor-row-more').click() }
const tasksMenu = async page => { const r = page.locator('.task-row', { hasText: /^Water the plants/ }).first(); await r.hover(); await r.locator('.row-menu .icon').click() }
for (const [where, path, opener] of [['a day page line', '/', editorMenu], ['a Tasks row', '/tasks', tasksMenu]]) {
  const [before, after] = [await menuOf(a, path, opener), await menuOf(b, path, opener)]
  const at = after.findIndex(t => t.startsWith('Blocked by'))
  const expected = at >= 0 ? [...after.slice(0, at + 1), ...after.slice(at + 2)] : after
  report(before.length > 0 && at >= 0 && after[at + 1] === 'Repeat…' && JSON.stringify(expected) === JSON.stringify(before), `the ⋯ menu of ${where}: only Repeat… is new, under Blocked by…`, JSON.stringify({ before, after }))
}
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
