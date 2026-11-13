// Dashboard step 3 in the built app (dashboard.md §4, dashboard-edit.md §9; D13 G6-6): rules across widgets at 1280.
// Usage: node tests/evidence/dashboard/filters.mjs <base-url> [chromium|webkit]  (the server on a store fresh from seed.ts; reseed per engine)
import * as pw from '@playwright/test'
const [base, only] = process.argv.slice(2), results = []
if (!base) { console.error('Usage: node tests/evidence/dashboard/filters.mjs <base-url> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch(), page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const tag = engine, settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await wait(300) }
  const widget = name => page.locator(`.dashboard-widget[aria-label^="${name} ·"]`).first()
  const titles = name => widget(name).locator('.database-title-cell').allInnerTexts()
  const open = async () => { await page.goto(`${base}/pages?page=lens`); await page.locator('.dashboard-widget').first().waitFor({ timeout: 20000 }); await settle() }
  const sheet = () => page.locator('.dashboard-filter')
  await open()
  const before = await page.evaluate(() => [...document.querySelectorAll('.dashboard-widget')].map(w => Math.round(w.getBoundingClientRect().top)).join(','))
  ok(`${tag} no rules: no chips row and no labels`, await page.locator('.dashboard-rules').count() === 0 && await page.locator('.dashboard-filter-label').count() === 0)

  // The sheet from the head's ⋯: properties once by name and type, with how many widgets have each.
  await page.locator('.dashboard-head [data-database-menu]').first().click(); await page.getByRole('menuitem', { name: 'Filter', exact: true }).click(); await settle()
  const stage = sheet().getByRole('menuitem').filter({ hasText: 'Stage' })
  ok(`${tag} the sheet lists Stage once, in 2 of 3 widgets`, await stage.count() === 1 && /2 of 3/.test(await stage.innerText()), await stage.innerText().catch(() => ''))
  await stage.click(); await settle()
  await sheet().locator('.database-rule-options label').filter({ hasText: 'Idea' }).locator('input').click(); await settle()
  await page.keyboard.press('Escape'); await settle()
  ok(`${tag} by name: Runs shows its Ideas, Reads its own Idea with other ids`, (await titles('Runs')).sort().join(',') === 'Alpha,Charlie' && (await titles('Reads')).join(',') === 'Dune', `${await titles('Runs')} / ${await titles('Reads')}`)
  ok(`${tag} the chip reads as a view's`, (await page.locator('.dashboard-rules').innerText()).includes('Stage is any of Idea'))
  ok(`${tag} Wide has no Stage: "Not filtered", and its rows all show`, (await widget('Wide').locator('.dashboard-filter-label').innerText()) === 'Not filtered' && (await titles('Wide')).length === 1)
  const place = await widget('Wide').evaluate(w => { const n = w.querySelector('.database-title').getBoundingClientRect(), l = w.querySelector('.dashboard-filter-label').getBoundingClientRect(); return Math.round(l.left - n.right) })
  ok(`${tag} the label sits right after the name`, place >= 0 && place <= 12, `${place} px after it`)
  ok(`${tag} where every rule applies, nothing is said`, await widget('Runs').locator('.dashboard-filter-label').count() === 0 && await widget('Reads').locator('.dashboard-filter-label').count() === 0)
  // From the label: the sheet marks the rule "Not in Wide".
  await widget('Wide').locator('.dashboard-filter-label').click(); await settle()
  ok(`${tag} the label opens the sheet, with the rule marked "Not in Wide"`, await sheet().getByText('Not in Wide').isVisible())
  await page.keyboard.press('Escape'); await settle()

  // A second rule Reads can't read: "Partly filtered"; the widgets' own filters are untouched.
  await page.locator('.dashboard-head [data-database-menu]').first().click(); await page.getByRole('menuitem', { name: 'Filter', exact: true }).click(); await settle()
  await sheet().getByRole('menuitem').filter({ hasText: 'Column 1' }).click(); await settle()
  await sheet().locator('.database-rule').nth(1).locator('select[aria-label="Condition"]').selectOption('isNotEmpty'); await settle()
  await page.keyboard.press('Escape'); await settle()
  ok(`${tag} a rule only some widgets have: "Partly filtered" there`, (await widget('Runs').locator('.dashboard-filter-label').innerText()) === 'Partly filtered' && (await widget('Wide').locator('.dashboard-filter-label').innerText()) === 'Partly filtered', `${await widget('Runs').locator('.dashboard-filter-label').innerText().catch(() => '')}`)
  ok(`${tag} nothing saved into a widget: its own filter chips are its own`, await widget('Runs').locator('.database-filter-chip').count() === 0)

  // A rename of the bound property keeps the rule on it.
  await page.goto(`${base}/pages?page=reads`); await page.locator('[data-column-head*="|rst"]').first().click(); await settle()
  const name = page.locator('.database-menu input[aria-label="Property name"], .database-menu input').first()
  await name.fill('Phase'); await name.press('Enter'); await settle(); await page.keyboard.press('Escape')
  await open()
  ok(`${tag} renaming Reads' Stage keeps the rule on it`, (await titles('Reads')).join(',') === 'Dune', `${await titles('Reads')}`)

  // + New in a widget follows both filters.
  await widget('Runs').getByRole('button', { name: '+ New' }).first().click(); await settle(); await page.keyboard.press('Escape'); await settle()
  await page.goto(`${base}/pages?page=runs`); await page.locator('.database-title-cell').first().waitFor(); await settle()
  const stages = await page.locator('[data-cell*="|st"]').allInnerTexts()
  ok(`${tag} + New in a widget takes the dashboard's Idea`, stages.filter(t => t.includes('Idea')).length === 3, stages.join(','))

  // A rule on Name reaches every widget, Wide too (Bumblebee 0d1055eb).
  await open()
  while (await page.locator('.dashboard-rules .database-chip-remove').count()) { await page.locator('.dashboard-rules .database-chip-remove').first().click(); await settle() }
  await page.locator('.dashboard-head [data-database-menu]').first().click(); await page.getByRole('menuitem', { name: 'Filter', exact: true }).click(); await settle()
  const nameEntry = sheet().getByRole('menuitem').filter({ hasText: /^Name/ })
  ok(`${tag} Name is listed first, in all 3`, /3 of 3/.test(await nameEntry.first().innerText()), await nameEntry.first().innerText().catch(() => ''))
  await nameEntry.first().click(); await settle()
  const field = sheet().locator('.database-rule input').first()
  await field.fill('a'); await field.press('Enter'); await settle(); await page.keyboard.press('Escape'); await settle()
  ok(`${tag} Name contains "a" filters every widget, labels none`, (await titles('Runs')).sort().join(',') === 'Alpha,Bravo,Charlie' && (await titles('Reads')).join(',') === 'Emma' && (await titles('Wide')).join(',') === 'A wide row' && await page.locator('.dashboard-filter-label').count() === 0, `${await titles('Runs')} / ${await titles('Reads')} / ${await titles('Wide')}`)

  // Removing the rules: chips and labels go, and the layout is as before.
  await open()
  while (await page.locator('.dashboard-rules .database-chip-remove').count()) { await page.locator('.dashboard-rules .database-chip-remove').first().click(); await settle() }
  const after = await page.evaluate(() => [...document.querySelectorAll('.dashboard-widget')].map(w => Math.round(w.getBoundingClientRect().top)).join(','))
  ok(`${tag} with the rules gone, no chips row, no labels, and the widgets where they were`, await page.locator('.dashboard-rules').count() === 0 && await page.locator('.dashboard-filter-label').count() === 0 && after === before, `${before} → ${after}`)
  ok(`${tag} no page errors`, errors.length === 0, errors.join(' | ').slice(0, 300))
  await browser.close()
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
