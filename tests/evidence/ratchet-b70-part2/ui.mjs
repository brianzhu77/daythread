import assert from 'node:assert/strict'
import { chromium, webkit } from '@playwright/test'
const base = 'http://127.0.0.1:3670'
const out = new URL('./results/', import.meta.url).pathname
for (const [name, engine, width] of [
  ['chromium', chromium, 1280],
  ['webkit', webkit, 390],
]) {
  if (process.argv[2] && process.argv[2] !== name) continue
  const browser = await engine.launch()
  for (const scheme of ['light', 'dark']) {
    if (process.argv[3] && process.argv[3] !== scheme) continue
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      colorScheme: scheme,
      serviceWorkers: 'block',
    })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(base + '/pages?view=templates')
    await page.locator('.account-row button').first().waitFor({ state: 'attached' })
    await page.getByRole('button', { name: 'New template', exact: true }).click()
    await page.locator('.template-target').waitFor()
    assert.ok(await page.locator('.page-title-field').evaluate((e) => e === document.activeElement))
    const id = new URL(page.url()).searchParams.get('page')
    const label = `UI ${name} ${scheme}`
    await page.keyboard.type(label)
    await page.locator('.bn-editor .bn-inline-content').first().click()
    await page.keyboard.type('Body ' + label)
    await page.waitForTimeout(900)
    for (const target of ['days', 'top-level', 'day-subpages', 'reading']) {
      await page.locator('.template-target').selectOption(target)
      await page.waitForTimeout(300)
      await page.reload()
      await page.locator('.template-target').waitFor()
      assert.equal(await page.locator('.template-target').inputValue(), target)
    }
    await page.locator('.template-target').selectOption('top-level')
    await page.waitForTimeout(350)
    await page.goto(base + '/pages')
    await page.locator('.title-row .round-add').click()
    await page.waitForURL(/focus=title/)
    await page.locator('.bn-editor').waitFor()
    assert.ok((await page.locator('.bn-editor').innerText()).includes('Body ' + label))
    await page.goto(base + '/pages?page=' + id)
    await page.locator('.template-target').selectOption('reading')
    await page.waitForTimeout(350)
    await page.goto(base + '/pages?page=reading')
    await page.locator('.bn-editor .bn-inline-content').last().click()
    await page.keyboard.press('Meta+ArrowRight')
    await page.waitForTimeout(180)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(180)
    await page.keyboard.type('/page', { delay: 60 })
    await page.getByText('New page inside this one', { exact: true }).click()
    await page.waitForTimeout(1000)
    assert.notEqual(new URL(page.url()).searchParams.get('page'), 'reading')
    assert.ok((await page.locator('.bn-editor').innerText()).includes('Body ' + label))
    await page.goto(base + '/pages?page=' + id)
    await page.locator('.template-target').waitFor()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    assert.equal(overflow, false)
    await page.screenshot({ path: `${out}/${name}-${scheme}-template.png`, fullPage: true })
    await page.getByRole('button', { name: 'Template actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    await page.waitForURL(/view=templates/)
    await page.getByRole('heading', { name: 'Templates', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await page.getByText('Default for pages in Reading', { exact: true }).waitFor()
    assert.ok(await page.getByRole('button', { name: 'Edit', exact: true }).count())
    const observerWarnings = errors.filter(
      (e) => e === 'ResizeObserver loop completed with undelivered notifications.',
    )
    if (observerWarnings.length)
      console.log('OBSERVED WebKit layout observer warning', observerWarnings.length)
    assert.equal(errors.length - observerWarnings.length, 0, errors.join('\n'))
    console.log(
      'PASS',
      name,
      width,
      scheme,
      'New/focus/edit; four targets persist; Pages+ and /Page copy; Delete+Undo; no overflow/errors',
    )
    await page.close()
  }
  await browser.close()
}
