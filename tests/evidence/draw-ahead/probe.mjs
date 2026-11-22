// Experiment (#374): with the outbox send held 3 s, does a new subpage show in the sidebar before the server answers?
// Usage: node tests/evidence/draw-ahead/probe.mjs <base-url>
import * as pw from '@playwright/test'
const base = process.argv[2], wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw.chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
await page.goto(`${base}/pages`)
const tree = page.getByRole('tree', { name: 'Pages' })
await tree.waitFor({ timeout: 20000 }); await page.waitForLoadState('networkidle').catch(() => {}); await wait(500)
const count = () => tree.getByRole('treeitem').count()
const before = await count()
await page.route('**/_serverFn/cedd5fc6*', async route => { await wait(3000); await route.continue() })
const plus = page.locator('button[aria-label="New page"], button:text-is("New page")').first()
await plus.click(); await page.getByRole('menuitem', { name: 'Page' }).click()
const t0 = Date.now(), seen = []
for (const at of [100, 300, 1000, 2500, 4000]) { await wait(at - (Date.now() - t0)); seen.push(`${at}ms:${(await count()) - before} new, url ${new URL(page.url()).pathname}${new URL(page.url()).search}`) }
console.log(seen.join(' | '))
await browser.close()
