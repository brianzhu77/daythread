// The comments pane beside a table (Jazz 73cd2b32, b03eeba4): opened from a cell's editor, the table scrolls until that cell is clear of the pane,
// never under the frozen title; away from the row's page the quote and the box name the row. 1280 (room made) and 1000 (the pane lies over).
// Usage: node tests/evidence/comments-property/pane.mjs <base-url>  (the server's store fresh from seed.ts)
import * as pw from '@playwright/test'
const [base] = process.argv.slice(2), results = []
if (!base) { console.error('Usage: node tests/evidence/comments-property/pane.mjs <base-url>'); process.exit(2) }
const chromium = pw.chromium, webkit = pw.webkit
const ok = (name, pass, detail = '') => { results.push([pass, name]); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
let n = 0
for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch()
  for (const width of [1280, 1000]) {
    const tag = `${engineName} ${width}`, page = await (await browser.newContext({ viewport: { width, height: 860 } })).newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}/pages?page=db`); await page.locator('.database-td').first().waitFor({ timeout: 15000 })
    const rowId = ['r1', 'r2', 'r3', 'r4'][n++]
    const cell = page.locator(`td:has([data-cell*="|${rowId}|e6"])`)
    await cell.locator('[data-cell]').click()
    await page.locator('.property-editor-foot').getByRole('button', { name: 'Comment' }).click()
    await page.locator('.comments-pane').waitFor(); await page.waitForTimeout(400)
    const geo = await page.evaluate(id => {
      const td = document.querySelector(`[data-cell*="|${id}|e6"]`).closest('td'), pane = document.querySelector('.comments-pane').getBoundingClientRect()
      const title = td.closest('tr').querySelector('.is-title').getBoundingClientRect(), box = td.getBoundingClientRect(), sc = td.closest('.database-scroll')
      return { right: Math.round(box.right), left: Math.round(box.left), pane: Math.round(pane.left), title: Math.round(title.right), scrolled: sc.scrollLeft, max: sc.scrollWidth - sc.clientWidth }
    }, rowId)
    const clear = width >= 1100 ? geo.right <= geo.pane - 11 : (geo.right <= geo.pane - 11 || geo.scrolled >= geo.max - 1)
    ok(`${tag} the cell it was opened from sits clear of the pane, not under the title`, clear && geo.left >= geo.title, JSON.stringify(geo))
    const names = { r1: 'Alpha', r2: 'Bravo', r3: 'Charlie', r4: 'Delta' }, said = await page.locator('.comments-pane .comment-quote.is-composing').innerText(), hint = await page.getByRole('textbox', { name: 'New comment' }).getAttribute('placeholder')
    ok(`${tag} from a table, the pane names the row`, said === `${names[rowId]} · Extra 6` && hint === `Comment on ${names[rowId]} · Extra 6`, `${said} · ${hint}`)
    await page.getByRole('textbox', { name: 'New comment' }).fill('Which row?')
    if (width >= 1100) await page.getByRole('textbox', { name: 'New comment' }).press('Meta+Enter'); else await page.locator('.comments-pane').getByRole('button', { name: 'Comment', exact: true }).click()
    await page.waitForTimeout(500)
    ok(`${tag} and its thread does too`, (await page.locator('.comments-pane .comment-thread .comment-quote').first().innerText()) === `${names[rowId]} · Extra 6`)
    await page.goto(`${base}/pages?page=${rowId}`); await page.locator('.row-property[data-property-id="e6"] .comment-count').click()
    ok(`${tag} on the row's own page, just the property`, (await page.locator('.comments-pane .comment-thread .comment-quote').first().innerText()) === 'Extra 6')
    ok(`${tag} no page errors`, errors.length === 0, errors.join(' | ').slice(0, 200))
    await page.context().close()
  }
  await browser.close()
}
console.log(`${results.filter(r => r[0]).length}/${results.length} passed`)
process.exit(results.every(r => r[0]) ? 0 : 1)
