import assert from 'node:assert/strict'
import { chromium, webkit } from '@playwright/test'
const base = 'http://127.0.0.1:3670'
for (const [name, engine] of [
  ['chromium', chromium],
  ['webkit', webkit],
]) {
  const b = await engine.launch(),
    p = await b.newPage({ viewport: { width: 1280, height: 900 } })
  await p.goto(base + '/pages?view=templates')
  await p.locator('.account-row-sidebar .account-item').first().waitFor()
  for (const width of [150, 194, 239, 350]) {
    const result = await p.evaluate(
      ({ width }) => {
        document.querySelector('#review-account')?.remove()
        const original = document.querySelector('.account-row-sidebar')
        const c = original.cloneNode(true)
        c.id = 'review-account'
        c.style.cssText = `position:fixed;top:20px;left:300px;width:${width}px;padding:0;z-index:99999;background:white;color:black`
        const paragraph = c.querySelector('p')
        const item = paragraph.querySelector('.account-item').cloneNode(true)
        item.querySelector('span').textContent = 'reviewer@a-long-but-valid-company-domain.example'
        paragraph.insertBefore(item, paragraph.firstChild)
        document.body.append(c)
        const r = c.getBoundingClientRect(),
          email = item.getBoundingClientRect()
        item.style.whiteSpace = 'normal'
        const baselineWidth = c.scrollWidth
        item.style.whiteSpace = ''
        const visibleSeps = [...c.querySelectorAll('.account-sep')].filter(
          (e) => e.getBoundingClientRect().width,
        )
        const bad = visibleSeps.filter((e) => {
          const s = e.getBoundingClientRect()
          return ![...e.parentElement.firstElementChild.getClientRects()].some(
            (v) => Math.abs(v.bottom - s.bottom) < 3,
          )
        })
        return {
          baselineWidth,
          width,
          containerRight: r.right,
          emailRight: email.right,
          scrollWidth: c.scrollWidth,
          clientWidth: c.clientWidth,
          badSeparators: bad.length,
          lastSeparatorVisible:
            paragraph.lastElementChild.querySelector('.account-sep').getBoundingClientRect().width >
            0,
        }
      },
      { width },
    )
    console.log(name, JSON.stringify(result))
    assert.equal(result.badSeparators, 0)
    assert.equal(result.lastSeparatorVisible, false)
    await p
      .locator('#review-account')
      .screenshot({ path: new URL(`./results/${name}-${width}.png`, import.meta.url).pathname })
  }
  await b.close()
}
