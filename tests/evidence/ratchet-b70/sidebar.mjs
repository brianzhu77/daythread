import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
const browser = await chromium.launch()
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    colorScheme: scheme,
  })
  await page.goto('http://127.0.0.1:3668/')
  await page.locator('.side-label-add').waitFor()
  const boxes = await page.evaluate(() => {
    const box = (e) => e.getBoundingClientRect()
    const label = document.querySelector('.side-label-row .side-label')
    const plus = document.querySelector('.side-label-add')
    const p = box(plus),
      l = box(label),
      r = box(document.querySelector('.tree-row'))
    const style = getComputedStyle(label)
    return {
      plusRight: p.right,
      actionRight: r.right - 4,
      plusCy: p.top + p.height / 2,
      labelCy: l.top + l.height / 2,
      colorsMatch: style.color === getComputedStyle(plus).color,
      oldHint: Boolean(document.querySelector('[aria-label="Pages in your days"]')),
      oldNewPage: [...document.querySelectorAll('button')].some(
        (e) => e.textContent === '＋ New page',
      ),
    }
  })
  assert.ok(Math.abs(boxes.plusRight - boxes.actionRight) <= 1)
  assert.ok(Math.abs(boxes.plusCy - boxes.labelCy) <= 1)
  assert.ok(boxes.colorsMatch && !boxes.oldHint && !boxes.oldNewPage)
  console.log('PASS sidebar', scheme, JSON.stringify(boxes))
  await page.screenshot({
    path: new URL(`./results/sidebar-${scheme}.png`, import.meta.url).pathname,
  })
  await page.close()
}
await browser.close()
