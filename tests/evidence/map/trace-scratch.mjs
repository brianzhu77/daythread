// The contract trace (map-contract.md §1): a scratch page with MapLibre 6.18 against OpenFreeMap, every outside request recorded. Serve trace-scratch.html as index.html next to MapLibre's dist files; label open | guard | evil.
import * as pw from '@playwright/test'
const [base, label] = process.argv.slice(2)
for (const engine of ['chromium', 'webkit']) for (const style of ['positron', 'dark']) {
  const b = await pw[engine].launch(engine === 'chromium' ? { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] } : {}), page = await (await b.newContext()).newPage()
  const reqs = [], viol = []
  page.on('request', r => { const u = new URL(r.url()); if (u.hostname !== '127.0.0.1') reqs.push({ host: u.hostname, path: u.pathname.split('/').slice(0, 3).join('/'), type: r.resourceType(), referer: r.headers()['referer'] ?? '', cookie: Boolean(r.headers()['cookie']) }) })
  page.on('console', m => { if (/Content Security Policy|CSP|Refused/.test(m.text())) viol.push(m.text().slice(0, 140)) })
  await page.goto(`${base}/?style=${style}${label === "open" ? "" : label === "guard" ? "&guard=1" : "&guard=1&evil=1"}`)
  const loaded = await page.waitForFunction(() => window.loaded, null, { timeout: 30000 }).then(() => true, () => false)
  await page.evaluate(() => { window.map.zoomTo(15); window.map.panBy([300, 200]) }); await page.waitForTimeout(3000)
  const errs = await page.evaluate(() => window.errs || [])
  const hosts = [...new Set(reqs.map(r => r.host))], kinds = [...new Set(reqs.map(r => `${r.host}${r.path}`))].sort()
  console.log(JSON.stringify({ label, engine, style, loaded, requests: reqs.length, hosts, referers: [...new Set(reqs.map(r => r.referer))], cookies: reqs.some(r => r.cookie), kinds: kinds.slice(0, 12), errs: errs.slice(0, 3), viol: viol.slice(0, 3) }))
  await b.close()
}
