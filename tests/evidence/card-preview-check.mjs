// B19 (Brian's UI comparison, Lead a2edc0a7): page-card preview line, and a past day's empty rows hidden on screen only.
//   node card-preview-check.mjs <base url> <db path> <playwright index.mjs>
import { DatabaseSync } from 'node:sqlite'
const [base, dbPath, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
const snapshot = () => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return JSON.stringify(d.prepare("SELECT id, sections, editorJSON FROM pages WHERE snapshot='current' ORDER BY id").all()) } finally { d.close() } }
const b = await chromium.launch(), errors = []
// The copy is upgraded on its first data load (migration 6 stamps the cards' times); do that before any snapshot.
{ const w = await b.newPage(); await w.goto(`${base}/day/2026-10-18`, { waitUntil: 'networkidle' }); await w.waitForTimeout(800); await w.close() }
for (const width of [1280, 390]) {
  const p = await b.newPage({ viewport: { width, height: 1000 } })
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const before = snapshot()
  await p.goto(`${base}/day/2026-10-18`, { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
  log(!(await p.locator('.bn-block-outer[data-id="e283f339-f3a4-41d2-a2b5-e3806a3f262b"]').isVisible()), `${width}: Oct 18's empty Events bullet is hidden`)
  log(JSON.stringify(await p.locator('.editor-page-card-preview').allInnerTexts()) === '["#recipe","#recipe"]', `${width}: the recipe cards show their first line under the title`)
  log(snapshot() === before, `${width}: nothing on the page was deleted or saved`)
  // Typing a new line on a past day: the empty line shows while the cursor is in it.
  const last = p.locator('.bn-block-outer').filter({ hasText: '肉酱意面' }).first()
  await last.locator('.bn-inline-content').first().evaluate(el => { el.closest('[contenteditable="true"]').focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })
  await p.waitForTimeout(100); await p.keyboard.press('Enter'); await p.waitForTimeout(300)
  const cursorLine = () => p.evaluate(() => { const n = getSelection().anchorNode; const el = (n instanceof Element ? n : n?.parentElement)?.closest('.bn-block-outer'); return { visible: Boolean(el?.offsetParent), text: el?.innerText.trim() } })
  let c = await cursorLine()
  log(c.visible && c.text === '', `${width}: a new empty line is visible while he types in it`, JSON.stringify(c))
  await p.keyboard.press('Backspace'); await p.waitForTimeout(1200)
  // The cursor into a hidden empty row (arrow keys) shows it.
  await p.locator('.bn-block-outer').filter({ hasText: 'English Lesson' }).first().locator('.bn-inline-content').first().evaluate(el => { el.closest('[contenteditable="true"]').focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })
  await p.waitForTimeout(100); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(300)
  c = await cursorLine()
  log(c.visible && c.text === 'Good Stuffs', `${width}: ArrowDown skips the hidden empty row (it's not on screen) and lands on the next line`, JSON.stringify(c))
  await p.goto(`${base}/day/2026-10-19`, { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
  log(await p.locator('.bn-block-outer').evaluateAll(es => es.filter(e => e.offsetParent && !e.querySelector('.bn-block-outer') && !e.innerText.trim()).length) === 0, `${width}: Oct 19 shows no empty rows (its blank TODO - Other task row too)`)
  // Lead 474d7849: ↓ from a heading goes into its section's hidden empty row, never into the next heading.
  await p.locator('.bn-block-outer').filter({ has: p.locator('h2, h3, [data-content-type="heading"]').filter({ hasText: 'Good Stuffs' }) }).first().locator('.bn-inline-content').first().click()
  await p.keyboard.press('End'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(200)
  c = await cursorLine()
  log(c.visible && c.text === '', `${width}: Oct 19, ↓ from Good Stuffs lands in its empty row, not in Notes`, JSON.stringify(c))
  await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  log(await p.locator('.bn-block-outer[data-id="day:2026-10-20:notes:template:0"]').isVisible(), `${width}: today keeps its empty template rows`)
  await p.close()
}
log(errors.length === 0, 'no page or console errors', errors.slice(0, 2).join(' | '))
await b.close()
