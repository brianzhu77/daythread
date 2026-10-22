// Brian cf4c4e65: nothing on the day page moves while he types the first letter into an empty row. Built server, sign-in
// off, fresh SQLite: node tests/evidence/typing-jump/stable-check.mjs <width> [path] [touch]
import { chromium } from '@playwright/test'
const width = Number(process.argv[2] ?? 1280), path = process.argv[3] ?? '/'
const touch = process.argv[4] === 'touch'
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width, height: 900 }, ...(touch ? { hasTouch: true, isMobile: true } : {}) }); const p = await ctx.newPage()
let failed = 0
const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}${touch ? ' touch' : ''} ${path}: ${what}${d ? ` (${d})` : ''}`) }
await p.goto('http://127.0.0.1:3429' + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
const create = p.getByRole('button', { name: /create page/i }); if (await create.count()) { await create.first().click(); await p.waitForTimeout(1000) }
// Every row's top and height, every heading's top: nothing on the page may move while he types into an empty row.
const layout = () => p.evaluate(() => [...document.querySelectorAll('.bn-block-outer')].filter(o => o.getClientRects().length).map(o => { const r = o.getBoundingClientRect(); return `${o.getAttribute('data-id')}@${r.top.toFixed(1)}+${r.height.toFixed(1)}` }))
const sections = ['TODO - Top 3', 'TODO - Other', 'Events', 'Good Stuffs', 'Notes']
for (const s of sections) {
  const h = p.locator('h1, h2, h3', { hasText: s }).first(); if (!(await h.count())) continue
  const hb = await h.boundingBox(); if (touch) await p.touchscreen.tap(hb.x + 140, hb.y + hb.height + 20); else await p.mouse.click(hb.x + 140, hb.y + hb.height + 20); await p.waitForTimeout(400)
  const type = await p.evaluate(() => { const n = window.getSelection().anchorNode; const el = n?.nodeType === 3 ? n.parentElement : n; return el?.closest?.('[data-content-type]')?.getAttribute('data-content-type') })
  const before = await layout()
  await p.keyboard.type('x'); await p.waitForTimeout(150)
  const typed = await layout()
  await p.waitForTimeout(1800)
  const saved = await layout()
  const moved = (a, z) => a.filter((r, i) => r !== z[i] && !r.startsWith(z[i]?.split('@')[0] + '@'))
  const diff = (a, z) => a.map((r, i) => [r, z[i]]).filter(([x, y]) => x !== y)
  const d1 = diff(before, typed), d2 = diff(before, saved)
  log(d1.length === 0 && d2.length === 0, `typing into the empty ${type} under "${s}" moves nothing`, d2.length ? `${d2.length} moved, e.g. ${d2[0].join(' → ')}` : '')
  await p.keyboard.press('Backspace'); await p.waitForTimeout(1500)
}
await b.close()
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0)
