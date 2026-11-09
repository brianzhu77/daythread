// Comments step 4 in the built app (comments.md §4, §6, P2-6): Comment from a property's name on a row page and from a table cell's editor,
// its quote, count and cell mark, a property hidden in the view, and an empty one with a comment kept out of the fold. 1280 and 390.
// Usage: node tests/evidence/comments-property/comments-property.mjs <base-url> [chromium|webkit]
//   The server at <base-url> runs on a store fresh from seed.ts: seed it and start the server again before each engine, as each adds comments.
import * as pw from '@playwright/test'
const [base, only] = process.argv.slice(2), results = []
if (!base) { console.error('Usage: node tests/evidence/comments-property/comments-property.mjs <base-url> [chromium|webkit]'); process.exit(2) }
const chromium = pw.chromium, webkit = pw.webkit
const ok = (name, pass, detail = '') => { results.push([pass, name]); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const settle = p => p.waitForLoadState('networkidle').catch(() => {})
const engines = only === 'webkit' ? [['webkit', webkit]] : only === 'chromium' ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]]
for (const [engineName, engine] of engines) {
  const browser = await engine.launch()
  for (const width of [1280, 390]) {
    const tag = `${engineName} ${width}`, phone = width < 600
    const context = await browser.newContext({ viewport: { width, height: 860 }, ...(phone ? { hasTouch: true, isMobile: engineName === 'chromium' } : {}) })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    const send = async () => { if (phone) await page.locator('.comments-pane').getByRole('button', { name: 'Comment', exact: true }).click(); else await page.getByRole('textbox', { name: 'New comment' }).press('Meta+Enter') }
    // Row page: from the property's name.
    const row = phone ? 'r3' : 'r1', noteRow = phone ? 'r4' : 'r2'
    await page.goto(`${base}/pages?page=${row}`); await page.locator('.row-properties').waitFor({ timeout: 15000 })
    await page.locator('.row-property[data-property-id="st"] .row-property-menu').click()
    await page.getByRole('menuitem', { name: 'Comment' }).click()
    const pane = page.locator('.comments-pane')
    await pane.waitFor({ timeout: 5000 })
    const quote = await pane.locator('.comment-quote.is-composing').innerText().catch(() => '')
    const placeholder = await page.getByRole('textbox', { name: 'New comment' }).getAttribute('placeholder')
    ok(`${tag} row page: Comment from the property's name, on its words`, quote === (phone ? 'Stage: Idea' : 'Stage: Idea') && placeholder === 'Comment on Stage', `${quote} · ${placeholder}`)
    await page.getByRole('textbox', { name: 'New comment' }).fill('Why still an idea?')
    await send(); await settle(page); await page.waitForTimeout(300)
    const threadQuote = await pane.locator('.comment-thread .comment-quote').first().innerText().catch(() => '')
    ok(`${tag} the thread reads as on the property`, threadQuote === 'Stage: Idea' && await pane.getByText('Why still an idea?').isVisible(), threadQuote)
    const count = page.locator('.row-property[data-property-id="st"] .comment-count')
    ok(`${tag} the property shows its count`, await count.isVisible() && (await count.getAttribute('aria-label')) === '1 comment on Stage')
    await pane.locator('.comment-thread button.comment-quote').first().click()
    ok(`${tag} its quote goes to the property`, await page.locator('.row-property[data-property-id="st"].is-comment-target').count() === 1)
    await page.getByRole('button', { name: 'Close comments' }).click()
    await count.click()
    ok(`${tag} the count opens the pane at its thread`, await pane.locator('.comment-thread.is-focused').count() === 1)
    await page.getByRole('button', { name: 'Close comments' }).click()
    // A row page's other properties have no mark, and a page that isn't a row has no property menu.
    ok(`${tag} no mark where there's no comment`, await page.locator('.row-property[data-property-id="note"] .comment-count').count() === 0)
    // A property hidden in the table view (Miles): its thread is on the row page, and the table draws no cell, so no mark.
    await page.locator('.row-property[data-property-id="n"] .row-property-menu').click()
    await page.getByRole('menuitem', { name: 'Comment' }).click()
    await page.getByRole('textbox', { name: 'New comment' }).fill('Hidden in the table')
    await send(); await settle(page); await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Close comments' }).click()
    ok(`${tag} hidden in the view: the row page shows its comment`, await page.locator('.row-property[data-property-id="n"] .comment-count').isVisible())
    // Table: from a cell's editor, and the cell's mark.
    await page.goto(`${base}/pages?page=db`); await settle(page)
    await page.locator('.database-td.has-comment').first().waitFor({ timeout: 10000 }).catch(() => {})
    const stageCell = page.locator(`td:has([data-cell*="|${row}|st"])`)
    ok(`${tag} table: the commented cell has a mark, an uncommented one none`, (await stageCell.count() === 0 || await stageCell.evaluate(td => td.classList.contains('has-comment'))) && await page.locator('td:has([data-cell*="|r5|st"])').evaluate(td => !td.classList.contains('has-comment')), `stage column ${await stageCell.count() ? 'shown' : 'not shown at this width'}`)
    ok(`${tag} hidden in the view: no cell and no mark in the table`, await page.evaluate(() => ![...document.querySelectorAll('[data-cell]')].some(el => el.getAttribute('data-cell').split('|').includes('n'))) && await page.locator('th:has-text("Miles")').count() === 0)
    await page.locator(`[data-cell*="|${noteRow}|note"]`).first().click()
    const foot = page.locator('.property-editor-foot').getByRole('button', { name: 'Comment' })
    await foot.waitFor({ timeout: 5000 }).catch(() => {})
    ok(`${tag} a cell's editor has Comment`, await foot.isVisible())
    await page.waitForTimeout(200); await page.keyboard.type('Long run')
    await foot.click()
    await pane.waitFor({ timeout: 5000 })
    const q2 = await pane.locator('.comment-quote.is-composing').innerText().catch(() => '')
    ok(`${tag} it saves what was typed, then comments on it`, q2 === 'Note: Long run', q2)
    await page.getByRole('textbox', { name: 'New comment' }).fill('Felt good')
    await send(); await settle(page); await page.waitForTimeout(300)
    ok(`${tag} the second cell gets its mark`, await page.locator(`td:has([data-cell*="|${noteRow}|note"])`).evaluate(td => td.classList.contains('has-comment')))
    // An empty property with a comment stays out of "N empty properties" (Bumblebee d2ed4d18).
    await page.locator('.comments-pane').count() && await page.getByRole('button', { name: 'Close comments' }).click()
    await page.locator(`[data-cell*="|${noteRow}|e1"]`).first().click()
    await page.locator('.property-editor-foot').getByRole('button', { name: 'Comment' }).click()
    await page.getByRole('textbox', { name: 'New comment' }).fill('Still empty')
    await send(); await settle(page); await page.waitForTimeout(300)
    await page.goto(`${base}/pages?page=${noteRow}`); await page.locator('.row-properties').waitFor()
    const foldText = await page.locator('.row-property-more').innerText().catch(() => '')
    ok(`${tag} an empty property with a comment isn't folded away`, await page.locator('.row-property[data-property-id="e1"] .comment-count').isVisible() && await page.locator('.row-property[data-property-id="e2"]').count() === 0 && /^5 empty/.test(foldText), `${foldText} · e1 count ${await page.locator('.row-property[data-property-id="e1"] .comment-count').count()} · e2 ${await page.locator('.row-property[data-property-id="e2"]').count()}`)
    ok(`${tag} no page errors`, errors.length === 0, errors.join(' | ').slice(0, 300))
    await page.goto(`${base}/pages?page=${row}`); await page.locator('.row-properties').waitFor()
    await page.locator('.row-property[data-property-id="st"] .row-property-menu').click()
    await context.close()
  }
  await browser.close()
}
const failed = results.filter(r => !r[0]).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
