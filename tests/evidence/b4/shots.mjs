// The two screenshots in this folder: node tests/evidence/b4/shots.mjs <base> <out dir> (built server, store copy).
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2], out = process.argv[3]
{ const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
  await p.goto(base); await p.locator('.continuous-editor .bn-block-outer').first().waitFor(); await p.waitForTimeout(1000)
  await p.locator('.continuous-editor .bn-block-outer .bn-inline-content').first().click(); await p.waitForTimeout(300); await p.keyboard.press('Meta+ArrowRight'); await p.waitForTimeout(200); await p.keyboard.press('Enter'); await p.keyboard.type('/'); await p.waitForTimeout(500)
  for (let i = 0; i < 10; i++) await p.keyboard.press('ArrowDown'); await p.waitForTimeout(300)
  await p.screenshot({ path: `${out}/laptop-menu.png` }); await b.close() }
{ const b = await webkit.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await p.addInitScript(k => { const vv = window.visualViewport; let up = 0; Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - up })
    document.addEventListener('focusin', () => setTimeout(() => { if (document.activeElement?.closest('[contenteditable="true"]') && !up) { up = k; vv.dispatchEvent(new Event('resize')) } }, 60)) }, 336)
  await p.goto(base); await p.locator('.continuous-editor .bn-block-outer').first().waitFor(); await p.waitForTimeout(1000)
  const low = p.locator('.continuous-editor .bn-block-outer .bn-inline-content').nth(8)
  await low.evaluate(e => window.scrollBy(0, e.getBoundingClientRect().top - 380)); await low.tap(); await p.waitForTimeout(400)
  await p.getByRole('button', { name: 'Insert block' }).tap(); await p.waitForTimeout(600)
  await p.screenshot({ path: `${out}/phone-menu.png`, clip: { x: 0, y: 0, width: 390, height: 508 } }); await b.close() }
