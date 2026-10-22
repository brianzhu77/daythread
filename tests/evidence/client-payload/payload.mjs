// Payload per screen: bytes the browser receives from loadWorkspace and from one command response.
//   node payload.mjs <base url> <playwright index.mjs>
const [base, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const seen = []
page.on('response', async r => { if (!r.url().includes('_serverFn')) return; try { const b = await r.body(); seen.push({ fn: decodeURIComponent(r.url()).match(/(loadWorkspace|runCommand|[a-zA-Z]+)_/)?.[1] ?? r.url().slice(-40), bytes: b.length, enc: r.headers()['content-encoding'] ?? 'none' }) } catch {} })
const report = label => { const s = seen.splice(0); for (const x of s) console.log(`${label}\t${x.fn}\t${x.bytes} bytes\t(${x.enc})`) }
for (const path of ['/day/2026-10-18', '/day/2026-10-22', '/pages', '/tasks']) { await page.goto(base + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(800); report(`open ${path}`) }
await page.goto(base + '/day/2026-10-18', { waitUntil: 'networkidle' }); await page.waitForTimeout(800); seen.splice(0)
const line = page.locator('.continuous-editor .bn-block-content[data-content-type=bulletListItem] .bn-inline-content').filter({ hasText: /\S/ }).last()
await line.click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.type(' x'); await page.waitForTimeout(2500)
report('save on 2026-10-18')
await browser.close()
