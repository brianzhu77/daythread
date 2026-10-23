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
// A new line at the end of Notes: click the end of its last line (a click mid-line would type into that line).
const typeInNotes = async (p, text) => {
  const last = p.locator('[data-node-type="blockContainer"]:has(> [data-content-type="bulletListItem"]) .bn-inline-content').last()
  const box = await last.boundingBox()
  await p.mouse.click(box.x + box.width - 1, box.y + box.height / 2); await p.waitForTimeout(200); await p.keyboard.press(`${mod}+ArrowRight`); await p.waitForTimeout(100)
  if ((await last.textContent()).trim()) { await p.keyboard.press('Enter'); await p.waitForTimeout(100) }
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
  log(await fresh.locator('text=Added unsaved text from another tab').count() > 0, 'and says "Added unsaved text from another tab"')
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
// (2b) Lead 62bf2071: a tab whose save went through but whose reply was lost, then closed. Its slot still holds text
// the server has (here also with a trailing space and an empty line). Reopening adds nothing twice.
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(() => { window.__daythreadGoneAfterMs = 1000 })
  const a = await ctx.newPage(); await a.goto(BASE + '/', { waitUntil: 'networkidle' }); await a.waitForTimeout(600)
  await typeInNotes(a, 'already saved line'); await a.waitForTimeout(1500)
  await a.close({ runBeforeUnload: true })
  // As if its reply had been lost: a closed tab's slot still holds the saved line (plus a trailing space and an empty
  // line), from a base before the line existed.
  const db = new DatabaseSync(DB, { readOnly: true })
  const row = db.prepare("SELECT id, editorJSON, sections FROM pages WHERE snapshot='current' AND type='daily' ORDER BY date DESC LIMIT 1").get(); db.close()
  const nodes = JSON.parse(String(row.editorJSON))
  const withNoise = nodes.map(n => JSON.stringify(n.content ?? '').includes('already saved line') ? { ...n, content: 'already saved line ' } : n).concat([{ id: 'noise-empty', type: 'paragraph', content: '', children: [] }])
  const base = JSON.stringify([[], null])
  const stale = await ctx.newPage(); await stale.goto(BASE + '/pages', { waitUntil: 'networkidle' })
  await stale.evaluate(([id, doc, base]) => localStorage.setItem(`daythread:editor:${id}:gone-tab`, JSON.stringify({ base, document: doc, seen: 0, closed: true })), [String(row.id), JSON.stringify(withNoise), base])
  await stale.goto(BASE + '/', { waitUntil: 'networkidle' }); await stale.waitForTimeout(2500)
  log(copies('already saved line') === 1, 'a closed tab whose save went through adds nothing twice (even with a trailing space and an empty line)', String(copies('already saved line')))
  await ctx.close()
}
// (2b2) Ratchet 2b858bf3: a parent line already saved, an unsaved child nested under it, the tab closed. The parent
// is unchanged, so it matches the page, but its child must still come back, nested and saved once.
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(() => { window.__daythreadGoneAfterMs = 1000 })
  const a = await ctx.newPage(); await a.goto(BASE + '/', { waitUntil: 'networkidle' }); await a.waitForTimeout(600)
  await typeInNotes(a, 'saved parent line'); await a.waitForTimeout(1500)
  await blockSaves(a)
  await a.keyboard.press('Enter'); await a.keyboard.press('Tab'); await a.keyboard.type('unsaved nested child'); await a.waitForTimeout(800)
  await a.close({ runBeforeUnload: true })
  const c = await ctx.newPage(); await c.goto(BASE + '/', { waitUntil: 'networkidle' }); await c.waitForTimeout(2500)
  const db = new DatabaseSync(DB, { readOnly: true })
  const nested = db.prepare("SELECT editorJSON FROM pages WHERE snapshot='current'").all().some(r => (JSON.parse(String(r.editorJSON ?? '[]'))).some(function has(n) { return (JSON.stringify(n.content ?? '').includes('saved parent line') && (n.children ?? []).some(k => JSON.stringify(k.content ?? '').includes('unsaved nested child'))) || (n.children ?? []).some(has) }))
  db.close()
  log(nested && copies('unsaved nested child') === 1 && copies('saved parent line') === 1, 'an unsaved child under an unchanged parent comes back nested and is saved once', `nested ${nested}, child ${copies('unsaved nested child')}, parent ${copies('saved parent line')}`)
  await ctx.close()
}
// (2c) A tab opened from another (window.open shares its sessionStorage, as a ⌘-click or "Duplicate tab" does) gets
// its own id, so both drafts survive (Ratchet 66accf58, Bumblebee 5ab67ef1); a plain reload keeps its id and draft.
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  const a = await ctx.newPage(); await a.goto(BASE + '/', { waitUntil: 'networkidle' }); await a.waitForTimeout(600)
  const popup = ctx.waitForEvent('page'); await a.evaluate(() => window.open('/', '_blank')); const d = await popup; await d.waitForLoadState('networkidle'); await d.waitForTimeout(600)
  const ids = await Promise.all([a, d].map(p => p.evaluate(() => sessionStorage.getItem('daythread.tab'))))
  log(ids[0] && ids[1] && ids[0] !== ids[1], 'a tab opened from another gets its own id', JSON.stringify(ids))
  await blockSaves(a); await typeInNotes(a, 'opener tab text')
  await a.reload({ waitUntil: 'networkidle' }); await a.waitForTimeout(1200)
  const after = await a.evaluate(() => sessionStorage.getItem('daythread.tab'))
  log(after === ids[0] && await a.locator('.bn-inline-content', { hasText: 'opener tab text' }).count() === 1, 'a reload keeps its id and its unsaved text', String(after === ids[0]))
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
