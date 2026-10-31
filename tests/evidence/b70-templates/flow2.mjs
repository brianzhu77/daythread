import { chromium } from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:3595'
const out = new URL('./results', import.meta.url).pathname
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail) }
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(String(e)))
// A top-level page "Recipes" to be a target.
await page.goto(`${base}/pages`)
page.once('dialog', d => d.accept('Recipes'))
await page.getByRole('button', { name: 'New page' }).first().click()
await page.waitForTimeout(1200)
const recipesUrl = page.url()
// + New template: opens with the title focused.
await page.goto(`${base}/pages?view=templates`)
await page.getByRole('button', { name: 'New template' }).click()
await page.locator('.template-target').waitFor()
await page.keyboard.type('Recipe')
await page.waitForTimeout(800)
check('new template title typed into the focused title', (await page.locator('.page-head').innerText()).includes('Recipe'))
// Its body: a heading and a to-do.
await page.locator('.bn-block-content').first().click()
await page.keyboard.type('Ingredients')
await page.waitForTimeout(1500)
// Default for: Pages in Recipes.
const options = await page.locator('.template-target option').allInnerTexts()
check('menu offers day pages, top-level pages, pages inside days and Recipes', ['Day pages', 'Top-level pages', 'Pages inside any day', 'Pages in Recipes'].every(w => options.some(o => o.startsWith(w))), JSON.stringify(options))
const recipesValue = await page.locator('.template-target option', { hasText: 'Recipes' }).getAttribute('value')
await page.locator('.template-target').selectOption(recipesValue)
await page.waitForTimeout(800)
check('notice names the target', await page.getByText('Now the default for pages in Recipes').isVisible())
await page.screenshot({ path: `${out}/1280-template-recipe.png` })
// A new page made inside Recipes with the / Page item starts from it.
await page.goto(recipesUrl)
await page.locator('.bn-block-content').first().click()
await page.keyboard.type('/page')
await page.waitForTimeout(500)
await page.keyboard.press('Enter')
await page.waitForTimeout(2000)
const body = await page.locator('.bn-editor').innerText().catch(() => '')
check('subpage of Recipes starts with Ingredients', body.includes('Ingredients'), JSON.stringify(body.slice(0, 120)) + ' ' + page.url())
await page.screenshot({ path: `${out}/1280-subpage.png` })
// Delete the template, then Undo.
await page.goto(`${base}/pages?view=templates`)
await page.locator('.card-row', { hasText: 'Recipe' }).first().click()
await page.locator('.template-target').waitFor()
await page.getByRole('button', { name: 'Template actions' }).click()
await page.getByRole('menuitem', { name: 'Delete' }).click()
await page.waitForTimeout(1000)
check('delete returns to the list with a notice', page.url().includes('view=templates') && await page.getByText("Deleted 'Recipe'").isVisible())
await page.getByRole('button', { name: 'Undo' }).click()
await page.waitForTimeout(1000)
check('Undo brings it back with its default', await page.getByText('Default for pages in Recipes').isVisible())
await page.screenshot({ path: `${out}/1280-list-two.png` })
check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(JSON.stringify(results.filter(r => !r.ok)))
