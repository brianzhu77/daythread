import assert from 'node:assert/strict'
import { chromium, webkit } from '@playwright/test'
const base = 'http://127.0.0.1:3668'
const innerWidthSafe = (width) => width + 1
const out = new URL('./results/', import.meta.url).pathname
for (const [engineName, engine] of [
  ['chromium', chromium],
  ['webkit', webkit],
]) {
  const browser = await engine.launch()
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.goto(base + '/pages?page=8f5f0f4e-70df-4370-97d0-5006dc4518d3')
    await page.locator('.template-target').waitFor()
    const geometry = await page.evaluate(() => {
      const rect = (e) => {
        const r = e.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      }
      const shown = (e) =>
        Boolean(e && e.getBoundingClientRect().width && e.getBoundingClientRect().height)
      const title = document.querySelector('.page-title-field')
      const notes = [...document.querySelectorAll('.template-note')]
      const account = [...document.querySelectorAll('.account-row')].find(shown)
      const links = account ? [...account.querySelectorAll('button.link')].filter(shown) : []
      return {
        title: rect(title),
        notes: notes.map(rect),
        account: account ? rect(account) : null,
        links: links.map((e) => ({ text: e.textContent, ...rect(e) })),
        overflow: document.documentElement.scrollWidth > innerWidth,
        viewport: innerWidth,
      }
    })
    assert.ok(geometry.notes.every((n) => Math.abs(n.left - geometry.title.left) < 1))
    assert.ok(geometry.notes.every((n) => n.right <= width + 1))
    assert.ok(!geometry.overflow)
    if (width === 1280) assert.ok(geometry.links.some((e) => e.text === 'Templates'))
    await page.goto(base + '/pages?view=templates')
    const account = page.locator(width === 390 ? '.account-row-phone' : '.account-row-sidebar')
    await account.getByRole('button', { name: 'Templates', exact: true }).waitFor()
    const boxes = await account.locator('button.link').evaluateAll((es) =>
      es.map((e) => {
        const r = e.getBoundingClientRect()
        return { text: e.textContent, left: r.left, right: r.right, cy: r.top + r.height / 2 }
      }),
    )
    assert.ok(boxes.every((e) => e.left >= 0 && e.right <= innerWidthSafe(width)))
    assert.ok(Math.abs(boxes[0].cy - boxes[1].cy) < 1)
    console.log('PASS account row', engineName, width, JSON.stringify(boxes))
    console.log(
      'PASS',
      engineName,
      width,
      'template title/meta left column, no clipping, account links present',
      JSON.stringify(geometry),
    )
    await page.goto(base + '/pages')
    await page.getByRole('heading', { name: 'Pages', exact: true }).waitFor()
    if (width === 1280) {
      const plus = page.locator('.side-label-add')
      await plus.focus()
      await page.keyboard.press('Enter')
    } else {
      await page.locator('.title-row .round-add').click()
    }
    await page.waitForURL(/focus=title/)
    await page.waitForTimeout(500)
    assert.ok(await page.locator('.page-title-field').evaluate((e) => e === document.activeElement))
    console.log('PASS', engineName, width, 'New page opens untitled with title focus')
    await page.screenshot({ path: `${out}/b71-${engineName}-${width}.png`, fullPage: true })
    await page.close()
  }
  await browser.close()
}
