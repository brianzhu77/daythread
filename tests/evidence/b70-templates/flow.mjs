import { chromium } from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:3595'
const out = new URL('./results', import.meta.url).pathname
const pad = n => String(n).padStart(2, '0')
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const now = new Date(), plus = n => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail) }
const browser = await chromium.launch()
for (const [w, h] of [[1280, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${base}/pages?view=templates`)
  await page.getByRole('heading', { name: 'Templates' }).waitFor()
  if (w === 1280) {
    check('built-in line shows with Edit', await page.getByText('Day pages start with TODO, Events, Good Stuffs and Notes.').isVisible())
    await page.screenshot({ path: `${out}/${w}-list-empty.png` })
    await page.getByRole('button', { name: 'Edit' }).click()
  } else {
    await page.getByRole('button', { name: /Day/ }).first().click()
  }
  await page.locator('.template-target').waitFor()
  check(`${w}: Default for shows Day pages`, (await page.locator('.template-target').inputValue()) === 'days')
  check(`${w}: grey line`, await page.getByText('New pages start from this template. To-dos are copied empty.').isVisible())
  if (w === 1280) {
    // Type a line under Notes and a to-do title under TODO.
    const notes = page.locator('.bn-block-outer', { has: page.locator('h2', { hasText: 'Notes' }) }).first()
    const lastBullet = page.locator('.bn-block-content[data-content-type="bulletListItem"]').last()
    await lastBullet.click()
    await page.keyboard.type('Gym?')
    const todoRow = page.locator('[data-content-type="task"]').first()
    await todoRow.click()
    await page.keyboard.type('Water plants')
    await page.waitForTimeout(1500)
    // The / menu has no Page item on a template: open it on a new empty bullet under Notes.
    await page.locator('.bn-block-content[data-content-type="bulletListItem"]').last().click()
    await page.keyboard.press('Meta+ArrowRight')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    await page.waitForTimeout(600)
    const items = await page.locator('.bn-suggestion-menu-item, [role="option"]').allInnerTexts()
    await page.screenshot({ path: `${out}/1280-slash.png` })
    check('/ menu opened', items.length > 0, String(items.length))
    check('no Page item in / menu', !items.some(t => /New page inside this one/.test(t)), JSON.stringify(items.map(t => t.split('\n')[0])))
    await page.keyboard.press('Escape')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(1500)
  }
  await page.screenshot({ path: `${out}/${w}-template.png`, fullPage: true })
  check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
  await page.close()
}
// The next new day copies it: open a far-future day, which ensure-day creates.
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const day = plus(3)
await page.goto(`${base}/day/${day}`)
await page.waitForTimeout(800)
const create = page.getByRole('button', { name: /Create|create/ })
if (await create.count()) await create.first().click()
await page.waitForTimeout(1500)
const text = await page.locator('.bn-editor').innerText().catch(() => '')
check('new day has Gym? copied', text.includes('Gym?'), JSON.stringify(text.slice(0, 200)))
check('new day to-do copied empty', !text.includes('Water plants'))
await page.screenshot({ path: `${out}/1280-new-day.png`, fullPage: true })
const ws = await (await fetch(`${base}/api/export`)).status
await page.goto(`${base}/pages`)
await page.waitForTimeout(800)
check('Pages list has no template', !(await page.locator('.card-row-title', { hasText: /^Day$/ }).count()))
await page.goto(`${base}/pages?view=templates`)
await page.waitForTimeout(800)
check('list row says Default for day pages', await page.getByText('Default for day pages').isVisible())
await page.screenshot({ path: `${out}/1280-list.png` })
await browser.close()
console.log(JSON.stringify(results.filter(r => !r.ok)))
