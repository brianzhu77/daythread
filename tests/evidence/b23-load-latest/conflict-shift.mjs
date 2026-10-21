// Does the conflict line move any row? Same page with and without the conflict line, every row's box compared,
// at 1280 and 390. The conflict is made by a recovery draft whose starting point isn't the page's (a stale tab).
//   node conflict-shift.mjs <base url> <db copy> <playwright index.mjs>
import { DatabaseSync } from 'node:sqlite'
const [base, dbPath, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const DAY = '2026-10-18'
const d = new DatabaseSync(dbPath, { readOnly: true }); const page = d.prepare("SELECT id, editorJSON FROM pages WHERE snapshot='current' AND type='daily' AND date=?").get(DAY); d.close()
const browser = await chromium.launch(); let failures = 0
for (const width of [1280, 390]) {
  const boxes = async (stale) => {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 }, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) })
    if (stale) await ctx.addInitScript(([key, doc]) => localStorage.setItem(key, JSON.stringify({ base: 'stale-start', document: doc })), [`daythread:editor:${page.id}`, page.editorJSON])
    const p = await ctx.newPage(); await p.goto(`${base}/day/${DAY}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
    const line = await p.locator('.editor-save-line').innerText()
    const rows = await p.evaluate(() => [...document.querySelectorAll('.continuous-editor .bn-block-content')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10] }))
    await ctx.close(); return { line, rows }
  }
  const plain = await boxes(false), conflict = await boxes(true)
  const moved = plain.rows.filter((r, i) => JSON.stringify(r) !== JSON.stringify(conflict.rows[i])).length
  const shown = /Changed in another tab/.test(conflict.line)
  console.log(`${shown && moved === 0 && plain.rows.length === conflict.rows.length ? 'ok  ' : 'FAIL'} ${width}: conflict line shown (${JSON.stringify(conflict.line.split('\n')[0])}); ${plain.rows.length} rows, ${moved} moved`)
  if (!shown || moved || plain.rows.length !== conflict.rows.length) failures++
}
await browser.close(); console.log(failures ? `${failures} failed` : 'all passed')
