// B35 part 2: one recovery slot per tab. (1) Two tabs' unsaved text both come back in the next tab (Ratchet's red
// case). (2) A tab suspended with unsaved text (frozen, as iOS does), another tab merges it, the first resumes: the
// lines appear once (Lead). Built server, sign-in off, fresh SQLite:
//   DB=<sqlite> node tests/evidence/b35/tabs-check.mjs <base>
import { chromium } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const [BASE] = process.argv.slice(2), DB = process.env.DB
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const b = await chromium.launch()
let failed = 0; const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} 1280: ${what}${d ? ` (${d})` : ''}`) }
const copies = text => { const db = new DatabaseSync(DB, { readOnly: true }); try { return db.prepare("SELECT editorJSON FROM pages WHERE snapshot='current'").all().reduce((n, r) => n + (String(r.editorJSON ?? '').split(text).length - 1), 0) } finally { db.close() } }
const typeInNotes = async (p, text) => {
  const h = await p.locator('h2', { hasText: 'Notes' }).first().boundingBox()
  await p.mouse.click(h.x + 60, h.y + h.height + 18); await p.waitForTimeout(200); await p.keyboard.press(`${mod}+ArrowRight`)
  if (await p.evaluate(() => (window.getSelection()?.anchorNode?.textContent ?? '').trim().length > 0)) await p.keyboard.press('Enter')
  await p.keyboard.type(text); await p.waitForTimeout(800)
}
const blockSaves = p => p.route('**/_serverFn/**', r => r.request().method() === 'POST' ? r.abort('failed') : r.continue())

// (1) Two tabs, saves blocked, each types, both close; a fresh tab brings back both.
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(() => { window.__daythreadGoneAfterMs = 1000 })
  const a = await ctx.newPage(), c = await ctx.newPage()
  for (const p of [a, c]) { await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(600); await blockSaves(p) }
  await typeInNotes(a, 'marker from tab A'); await typeInNotes(c, 'marker from tab B')
  const slots = await a.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daythread:editor:')).length)
  log(slots === 2, 'two tabs keep two slots', String(slots))
  await a.close({ runBeforeUnload: true }); await c.close({ runBeforeUnload: true })
  const fresh = await ctx.newPage(); await fresh.goto(BASE + '/', { waitUntil: 'networkidle' }); await fresh.waitForTimeout(2500)
  log(copies('marker from tab A') === 1 && copies('marker from tab B') === 1, 'a fresh tab brings back both and saves each once', `${copies('marker from tab A')}, ${copies('marker from tab B')}`)
  await ctx.close()
}
// (2) A suspended tab whose slot another tab merged: it comes back and doesn't save its copy again.
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(() => { window.__daythreadGoneAfterMs = 1000 })
  const a = await ctx.newPage(); await a.goto(BASE + '/', { waitUntil: 'networkidle' }); await a.waitForTimeout(600)
  await blockSaves(a); await typeInNotes(a, 'suspended tab line'); await a.waitForTimeout(500)
  const cdp = await ctx.newCDPSession(a); await cdp.send('Page.setWebLifecycleState', { state: 'frozen' })
  await new Promise(r => setTimeout(r, 1800))
  const other = await ctx.newPage(); await other.goto(BASE + '/', { waitUntil: 'networkidle' }); await other.waitForTimeout(2500)
  log(copies('suspended tab line') === 1, 'another tab merges the suspended tab\'s text and saves it', String(copies('suspended tab line')))
  await a.unroute('**/_serverFn/**'); await cdp.send('Page.setWebLifecycleState', { state: 'active' })
  await a.bringToFront(); await a.waitForTimeout(6000)
  log(copies('suspended tab line') === 1, 'the suspended tab resumes and doesn\'t save its copy again', String(copies('suspended tab line')))
  const shown = await a.locator('.bn-inline-content', { hasText: 'suspended tab line' }).count()
  log(shown === 1, 'and it shows the line once, from the latest page', String(shown))
  await ctx.close()
}
// (3) Two live tabs: a tab opening the page never takes over another tab that's still open (the real 2-minute rule).
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  const a = await ctx.newPage(); await a.goto(BASE + '/', { waitUntil: 'networkidle' }); await a.waitForTimeout(600)
  await blockSaves(a); await typeInNotes(a, 'live tab text'); await a.waitForTimeout(500)
  const c = await ctx.newPage(); await c.goto(BASE + '/', { waitUntil: 'networkidle' }); await c.waitForTimeout(2500)
  const claimed = await c.evaluate(() => Object.values(localStorage).filter(v => v.includes('claimedBy')).length)
  log(claimed === 0 && copies('live tab text') === 0 && await c.locator('.bn-inline-content', { hasText: 'live tab text' }).count() === 0, 'a tab that is still open is never taken over', `claimed ${claimed}`)
  await ctx.close()
}
console.log(failed ? `${failed} FAILED` : 'all passed'); await b.close(); process.exit(failed ? 1 : 0)
