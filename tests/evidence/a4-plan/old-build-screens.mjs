// Today's built app on the downgraded copy: the card to the held page, the task written in it, and the subpage
// restored on its own. Usage: node old-build-screens.mjs <base> <playwright index.mjs> <out dir>
const [base, pw, out] = process.argv.slice(2)
const { chromium } = await import(pw)
const b = await chromium.launch(), issues = []
const d = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
d.on('pageerror', e => issues.push(`pageerror ${e.message}`)); d.on('console', m => { if (m.type() === 'error') issues.push(`console ${m.text().slice(0, 140)}`) })
await d.goto(base + '/day/2026-10-18'); await d.waitForSelector('.continuous-editor'); await d.waitForTimeout(1500)
const cardText = await d.locator('.editor-page-card').allInnerTexts()
console.log('3. Oct 18 cards:', cardText.map(t => t.replace(/\n/g, ' ')))
const missing = d.locator('.editor-page-card', { hasText: 'Page not found' })
console.log('   held-page card offers Retry (would create a page with the held id):', (await d.locator('.editor-page-card-failed').count()) > 0)
await d.screenshot({ path: `${out}/old-card.png` })
await d.goto(base + '/tasks?view=open'); await d.waitForTimeout(1500)
const row = d.locator('.task-row', { hasText: 'Buy rosemary for focaccia' }).first()
console.log('4. task listed:', await row.count() > 0, '|', (await row.innerText().catch(() => '')).replace(/\n/g, ' | '))
const box = row.locator('input[type=checkbox]').first()
if (await box.count()) { await box.click(); await d.waitForTimeout(1000); console.log('   ticked ->', (await row.innerText().catch(() => '(row left the open list)')).replace(/\n/g, ' | ')) }
await d.screenshot({ path: `${out}/old-task.png` })
await d.goto(base + '/pages'); await d.waitForTimeout(1500)
console.log('5. Pages:', (await d.locator('.list-screen').innerText()).replace(/\n/g, ' | '))
console.log('issues', issues)
await b.close()
