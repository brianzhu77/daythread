// B98 (Jazz 47fa67dd, Ratchet bab28cc3): two tabs edit the same widget's filter. The second, from a tab that hadn't seen
// the first, is never built again over it: it's held and named, for him to keep or discard, and neither edit wins unsaid.
// Usage: node tests/evidence/dashboard/filter-tabs.mjs <base-url> <store-path> [chromium|webkit]
//   The server at <base-url> runs on <store-path>, fresh from tests/evidence/dashboard/seed.ts (one engine per seeding).
import * as pw from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const [base, storePath, only] = process.argv.slice(2), results = []
if (!base || !storePath) { console.error('Usage: node tests/evidence/dashboard/filter-tabs.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const T = 'To-dos · Open'
const widgetFilter = () => { const db = new DatabaseSync(storePath, { readOnly: true }); try { const ws = JSON.parse(db.prepare('SELECT data FROM workspace WHERE id = 1').get().data); return ws.pages.find(p => p.id === 'home').database.views.find(v => v.id === 'dash').dashboard.rows.flatMap(r => r.widgets).find(w => w.id === 'w-todos').view.filter } finally { db.close() } }
// The widget gets a second rule, so the two tabs' edits differ: A takes out the first, B (behind) the second.
{ const db = new DatabaseSync(storePath); try { const row = db.prepare('SELECT data FROM workspace WHERE id = 1').get(), ws = JSON.parse(row.data); const w = ws.pages.find(p => p.id === 'home').database.views.find(v => v.id === 'dash').dashboard.rows.flatMap(r => r.widgets).find(x => x.id === 'w-todos'); w.view.filter.push({ by: 'title', op: 'contains', value: 'e' }); db.prepare('UPDATE workspace SET data = ? WHERE id = 1').run(JSON.stringify(ws)) } finally { db.close() } }
const engine = only ?? 'chromium'
const browser = await pw[engine].launch(), desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const settle = async p => { await p.waitForLoadState('networkidle').catch(() => {}); await wait(400) }
const widget = p => p.locator(`.dashboard-widget[aria-label="${T}"]`).first()
const [a, b] = [await desk.newPage(), await desk.newPage()]
for (const p of [a, b]) { await p.goto(`${base}/pages?page=home`); await widget(p).waitFor({ timeout: 20000 }); await settle(p) }
const before = JSON.stringify(widgetFilter())
// Tab A removes the widget's first rule; tab B, which still shows both, removes the second: two edits to one filter.
await widget(a).locator('.database-rule-remove, button[aria-label^="Remove"]').first().click(); await settle(a)
const afterA = JSON.stringify(widgetFilter())
await widget(b).locator('.database-rule-remove, button[aria-label^="Remove"]').nth(1).click(); await settle(b); await wait(800)
const text = (await b.locator('.banner.save-failed').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
ok(`${engine} tab A's filter edit lands`, afterA !== before, `${before} → ${afterA}`)
ok(`${engine} tab B's edit to the same filter, from behind, is held and named, not built again over A's ("${text}")`, /^Not saved — filtered "To-dos · Open" was changed elsewhere/.test(text) && /Keep mine/.test(text) && /Discard/.test(text) && JSON.stringify(widgetFilter()) === afterA)
await browser.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
