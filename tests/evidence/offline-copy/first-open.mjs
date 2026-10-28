// #24 fix check (Ratchet #222): a fresh browser's first open keeps its screen, files and data; offline reopen shows
// the day from the copy. Usage: node tests/evidence/offline-copy/first-open.mjs <base> [chromium|webkit]
import { chromium, webkit } from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:3571', engine = process.argv[3] === 'webkit' ? webkit : chromium
const browser = await engine.launch(), context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage()
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`) }
await page.goto(base + '/')
await page.locator('.bn-editor').first().waitFor({ timeout: 30000 })
await page.evaluate(() => navigator.serviceWorker.ready)
await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
await page.waitForTimeout(1000)
const kept = await page.evaluate(async () => Object.fromEntries(await Promise.all((await caches.keys()).map(async k => [k, (await (await caches.open(k)).keys()).map(x => new URL(x.url).pathname)]))))
const shell = Object.entries(kept).find(([k]) => k.endsWith('-shell'))?.[1] ?? [], assets = Object.entries(kept).find(([k]) => k.endsWith('-assets'))?.[1] ?? []
check('first open keeps Today', shell.includes('/'), JSON.stringify(shell))
check('first open keeps its JS and CSS', assets.some(a => a.endsWith('.js')) && assets.some(a => a.endsWith('.css')), JSON.stringify(assets))
const record = await page.evaluate(() => new Promise(resolve => { const r = indexedDB.open('daythread-offline', 1); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('workspace'); g.onsuccess = () => resolve(g.result ? { owner: g.result.owner, revision: g.result.workspace?.revision } : null) } }))
check('the data copy is kept under its account', record?.owner === 'local' && typeof record.revision === 'number', JSON.stringify(record))
const typed = await page.evaluate(() => document.querySelector('.bn-editor')?.textContent?.length ?? 0)
// Playwright's WebKit here fails every offline navigation, even to a screen the worker kept while it was in control
// (page.goto/reload: "WebKit encountered an internal error"), so in WebKit the check stops at what was kept.
if (engine === webkit) { console.log('SKIP offline reopen in WebKit (Playwright limit, see above)'); await browser.close(); process.exit(results.every(Boolean) ? 0 : 1) }
await context.setOffline(true)
await page.reload()
await page.locator('.bn-editor').first().waitFor({ timeout: 15000 })
const body = await page.locator('body').innerText()
check('offline reopen shows the day', !body.includes("hasn't been opened") && body.includes('Offline · showing what was last loaded'), body.split('\n').slice(0, 3).join(' / '))
check('offline reopen shows the same page text', Math.abs((await page.evaluate(() => document.querySelector('.bn-editor')?.textContent?.length ?? 0)) - typed) === 0)
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
