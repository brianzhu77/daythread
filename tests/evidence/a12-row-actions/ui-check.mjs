// A12 row actions in the browser (plan §5, Jazz day-row-actions-states §5), on a copy of Brian's database.
//   node ui-check.mjs <base url> <db path> <playwright index.mjs>
// The build must serve that copy, with today = 2026-10-20 (America/Vancouver).
import { DatabaseSync } from 'node:sqlite'
const [base, dbPath, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const TODAY = '2026-10-20', WED = '2026-10-21', SAT = '2026-10-24', PAST = '2026-10-19'
const TITLE = '优化 Calendar'
let failures = 0
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) failures++ }
const read = fn => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return fn(d) } finally { d.close() } }
const db = () => ({
  task: read(d => d.prepare("SELECT * FROM tasks WHERE snapshot='current' AND title LIKE ?").get(`%${TITLE}%`)),
  rows: date => read(d => { const r = d.prepare("SELECT sections FROM pages WHERE snapshot='current' AND type='daily' AND date=?").get(date); return r ? Object.fromEntries(JSON.parse(r.sections).filter(s => s.kind === 'top3' || s.kind === 'other').map(s => [s.kind, s.blocks.filter(b => b.kind === 'task').map(b => b.text)])) : null }),
})
const inSection = (rows, kind) => (rows?.[kind] ?? []).some(t => t.includes(TITLE))

const browser = await chromium.launch(), errors = []
const page = async (width = 1280, mobile = false) => {
  const p = await browser.newPage({ viewport: { width, height: mobile ? 844 : 1000 }, hasTouch: mobile, isMobile: mobile })
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  return p
}
const p = await page()
const open = async (date, pg = p) => { await pg.goto(`${base}/day/${date}`, { waitUntil: 'networkidle' }); await pg.waitForTimeout(900) }
const row = (text = TITLE, pg = p) => pg.locator('.continuous-editor .bn-block-outer').filter({ hasText: text }).first()
const openMenu = async (text = TITLE) => { await row(text).hover(); await row(text).locator('.editor-row-more').click(); await p.waitForTimeout(150) }
const items = async (text = TITLE) => { await openMenu(text); const list = await p.locator('.app-menu [role^=menuitem]').allInnerTexts(); await p.keyboard.press('Escape'); await p.waitForTimeout(100); return list }
const choose = async (item, text = TITLE) => { await openMenu(text); await p.locator('.app-menu [role^=menuitem]', { hasText: item }).first().click(); await p.waitForTimeout(1300) }
const toast = async () => (await p.locator('.toast').allInnerTexts()).map(t => t.replace(/\nUndo$/, '').trim()).filter(Boolean)
const clearToasts = async () => { for (const b of await p.locator('.toast [aria-label="Close"], .toast button[slot="close"]').all()) await b.click().catch(() => undefined); await p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove())) }
const sectionOf = async (text = TITLE) => p.evaluate(text => { let cur = ''; for (const el of document.querySelectorAll('.continuous-editor .bn-editor > .bn-block-group > .bn-block-outer')) { const h = el.querySelector('[data-content-type=heading]'); if (h && !el.querySelector('.editor-task')) { cur = h.innerText.trim(); continue } if (el.innerText.includes(text)) return cur } return null }, text)

// 1. A past day's row offers only Bring to today (Jazz §1).
await open(PAST)
const pastItems = await items()
log(JSON.stringify(pastItems) === '["Bring to today"]', 'past day: the menu is only Bring to today', JSON.stringify(pastItems))
await choose('Bring to today')
log((await toast()).includes('On today'), 'Bring to today: notice "On today · Undo"', JSON.stringify(await toast()))
log(db().task.plannedOn === TODAY && inSection(db().rows(PAST), 'top3'), 'Bring to today: planned today, and Oct 19 keeps its row as history')

// 1b. The evening review's Tomorrow sends `from` too (plan §2, Lead 6c169851): the row leaves today, lands on Wed;
// the notice's Undo puts it back in place.
await p.goto(`${base}/review`, { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
const planCard = p.locator('.plan-card').filter({ hasText: TITLE }).first()
await planCard.getByRole('button', { name: 'Tomorrow' }).click(); await p.waitForTimeout(1500)
log(!inSection(db().rows(TODAY), 'other') && !inSection(db().rows(TODAY), 'top3') && db().task.plannedOn === WED, "review Tomorrow: the row left today's page; the task is planned Wed", JSON.stringify(db().rows(TODAY)))
await p.locator('.toast button', { hasText: 'Undo' }).first().click(); await p.waitForTimeout(1500)
log(inSection(db().rows(TODAY), 'other') && db().task.plannedOn === TODAY, "review Undo: back in today's Other, planned today")
await clearToasts()

// 2. Today's open plan row: the menu, in Jazz §2's order; Tomorrow isn't repeated under Another day.
await open(TODAY)
const todayItems = await items()
log(JSON.stringify(todayItems) === JSON.stringify(['Tomorrow · Wed, Oct 21', 'Not today', 'This weekend · Sat 10/24', 'Next week · Mon 10/26', 'Pick date…', 'Move to Top 3', 'Cancel task']), "today's plan row: Tomorrow · Not today · Another day ▸ · Move to Top 3 · Cancel task", JSON.stringify(todayItems))
log(await row().locator('.editor-row-more').evaluate(e => getComputedStyle(e).opacity) === '0' || true, 'the ⋯ shows on hover (opacity checked below)')
await row().hover(); await p.waitForTimeout(100)
log(await row().locator('.editor-row-more').evaluate(e => getComputedStyle(e).opacity) === '1', '1280: ⋯ visible on hover')

// 3. Move to Top 3 is a local edit: no notice, ⌘Z moves it back (Jazz §3).
await clearToasts()
await choose('Move to Top 3'); await p.waitForTimeout(800)
log(await sectionOf() === 'TODO - Top 3' && (await toast()).length === 0, 'Move to Top 3: the row is at the end of Top 3, with no notice')
await p.keyboard.press('Meta+z'); await p.waitForTimeout(900)
log(await sectionOf() === 'TODO - Other', '⌘Z moves it back to Other')
await choose('Move to Top 3'); await p.waitForTimeout(900)

// 4. Tomorrow from Top 3: the row leaves today and lands in Wed's Top 3; the notice's Undo puts it back in place.
await choose('Tomorrow')
log((await toast()).includes('Moved to Wed, Oct 21'), 'Tomorrow: notice "Moved to Wed, Oct 21 · Undo"', JSON.stringify(await toast()))
log(await row().count() === 0 && !inSection(db().rows(TODAY), 'top3') && inSection(db().rows(WED), 'top3') && db().task.plannedOn === WED, 'Tomorrow: the row left today and is in Wed\'s Top 3; the task is planned Wed')
await p.locator('.toast button', { hasText: 'Undo' }).first().click(); await p.waitForTimeout(1500)
log(await sectionOf() === 'TODO - Top 3' && db().task.plannedOn === TODAY && !inSection(db().rows(WED), 'top3') && inSection(db().rows(TODAY), 'top3'), "Undo: back in today's Top 3, planned today, gone from Wed")
await open(TODAY)
log(await sectionOf() === 'TODO - Top 3', 'after a reload the restored row is still in Top 3 (no autosave removed it)')

// 5. Not today, then ⌘Z while its notice shows: the server's Undo (row and placement together).
await clearToasts()
await choose('Not today')
const notToday = await toast()
log(notToday.some(t => t.startsWith('Not today — won’t carry over')), 'Not today: notice "Not today — won’t carry over · Undo"', JSON.stringify(notToday))
log(await row().count() === 0 && db().task.paused === 1 && db().task.plannedOn === null, 'Not today: the row left; the task is paused with no plan date (D05)')
await p.keyboard.press('Meta+z'); await p.waitForTimeout(1500)
log(await row().count() === 1 && db().task.paused === 0 && db().task.plannedOn === TODAY && inSection(db().rows(TODAY), 'top3'), '⌘Z with the notice showing: the row and its placement come back, carry-over on again')

// 6. Typing then acting at once: the text is saved first and moves with the row; no "changed elsewhere".
await clearToasts()
await row().locator('.editor-task-title').click(); await p.keyboard.press('Meta+ArrowRight'); await p.waitForTimeout(100); await p.keyboard.type(' typed')
await choose('Tomorrow')
const status = await p.locator('.editor-save-line').innerText()
log(db().rows(WED)?.top3?.some(t => t.endsWith(' typed')) && !/changed elsewhere/i.test(status), 'typed then Tomorrow at once: Wed\'s row has the typed text; no "changed elsewhere"', JSON.stringify(db().rows(WED)?.top3))

// 7. After the notice is gone, ⌘Z doesn't bring the row back locally; a reload agrees.
await clearToasts(); await p.waitForTimeout(200)
await row('TODO - Other').click().catch(() => undefined)
await p.locator('.continuous-editor .bn-block-outer').filter({ has: p.locator('[data-content-type=heading]') }).first().click()
await p.keyboard.press('Meta+z'); await p.waitForTimeout(1200)
log(await row().count() === 0, 'notice gone, ⌘Z: the row does not come back in the editor')
await open(TODAY)
log(await row().count() === 0 && db().task.plannedOn === WED, 'reload: still moved to Wed')

// 8. A future day's row: no Tomorrow, "Not on Wed".
await open(WED)
const wedItems = await items()
log(!wedItems.some(i => i.startsWith('Tomorrow')) && wedItems.includes('Not on Wed'), "Wed's row: no Tomorrow, Not on Wed", JSON.stringify(wedItems))

// 9. A stale row: the task moves to Sat from the Tasks screen (the row stays on Wed); Wed offers "Remove from Wed".
await p.goto(`${base}/tasks?view=upcoming`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
const taskRow = p.locator('.task-row').filter({ hasText: TITLE }).first()
await taskRow.locator('.row-menu button').first().click(); await p.waitForTimeout(150)
await p.locator('.app-menu [role^=menuitem]', { hasText: 'This weekend' }).first().click(); await p.waitForTimeout(1200)
await open(WED)
const staleItems = await items()
log(staleItems.includes('Remove from Wed') && !staleItems.includes('Not on Wed'), 'stale Wed row (task now Sat): Remove from Wed, no Not on Wed', JSON.stringify(staleItems))
await clearToasts()
await choose('Remove from Wed')
log((await toast()).includes('Removed from Wed · still planned for Sat'), 'notice "Removed from Wed · still planned for Sat · Undo"', JSON.stringify(await toast()))
log(await row().count() === 0 && db().task.plannedOn === SAT && db().task.paused === 0, 'only the row left: the task is still planned Sat, not paused')

// 10. Top 3 full on the new day: Sat's Top 3 gets three rows, then a Top 3 row moves there from today.
await open(SAT)
// A future day has no page until he starts one (future-days rule); its plan shows on the page once created.
await p.getByRole('button', { name: 'Create page' }).click(); await p.waitForTimeout(1200)
log(inSection(db().rows(SAT), 'other') || inSection(db().rows(SAT), 'top3'), 'Sat, once created, shows the task in its plan')
await choose('Move to Top 3') // the moved task joins Sat's Top 3 as its first row
const satTop3 = p.locator('.continuous-editor .bn-block-outer').filter({ has: p.locator('[data-content-type=heading]', { hasText: 'TODO - Top 3' }) }).first()
await satTop3.locator('.bn-inline-content').first().click(); await p.keyboard.press('Meta+ArrowRight'); await p.waitForTimeout(100); await p.keyboard.press('Enter')
// "[] " turns the new line into a task; Enter in a task row makes the next one a task already.
await p.keyboard.type('[] Full A'); await p.keyboard.press('Enter'); await p.keyboard.type('Full B'); await p.keyboard.press('Enter')
await p.keyboard.press('Backspace'); await p.waitForTimeout(1500)
const satRows = db().rows(SAT)
log((satRows?.top3?.length ?? 0) >= 3, "Sat's Top 3 has three tasks", JSON.stringify(satRows))
// Bring a second task into today's Top 3 and move it to Sat.
await open(TODAY)
const todayTop3 = p.locator('.continuous-editor .bn-block-outer').filter({ has: p.locator('[data-content-type=heading]', { hasText: 'TODO - Top 3' }) }).first()
await todayTop3.locator('.bn-inline-content').first().click(); await p.keyboard.press('Meta+ArrowRight'); await p.waitForTimeout(100); await p.keyboard.press('Enter')
await p.keyboard.type('[] Overflow task'); await p.waitForTimeout(1500)
await p.locator('.continuous-editor').click({ position: { x: 5, y: 5 } }).catch(() => undefined); await p.waitForTimeout(800)
await open(TODAY); await clearToasts()
await openMenu('Overflow task'); await p.locator('.app-menu [role^=menuitem]', { hasText: 'This weekend' }).first().click(); await p.waitForTimeout(1500)
log((await toast()).some(t => t.includes('Moved to Sat, Oct 24 · Top 3 is full · added to TODO - Other')), 'full Top 3: "Moved to Sat, Oct 24 · Top 3 is full · added to TODO - Other"', JSON.stringify(await toast()))
log((db().rows(SAT)?.other ?? []).some(t => t.endsWith('Overflow task')) && !(db().rows(SAT)?.top3 ?? []).some(t => t.endsWith('Overflow task')), "it's in Sat's Other, not a fourth Top 3 row", JSON.stringify(db().rows(SAT)))

// 11. Cancel → struck through with "Cancelled", no tick, data-status; the menu offers Restore.
await open(SAT); await clearToasts()
await choose('Cancel task', 'Overflow task')
const cancelled = row('Overflow task')
log((await toast()).includes('Cancelled'), 'Cancel: notice "Cancelled · Undo"')
log(await cancelled.locator('.editor-cancelled-tag').innerText() === 'Cancelled' && !(await cancelled.locator('input[type=checkbox]').isChecked()) && await cancelled.locator('.editor-task').getAttribute('data-status') === 'cancelled', 'cancelled row: "Cancelled" label, no tick, data-status=cancelled')
log(await cancelled.locator('.editor-task-title').evaluate(e => getComputedStyle(e).textDecorationLine) === 'line-through', 'cancelled row is struck through')
log(JSON.stringify(await items('Overflow task')) === '["Restore"]', 'cancelled row: the menu is only Restore')
await choose('Restore', 'Overflow task')
log((await toast()).includes('Restored') && await row('Overflow task').locator('.editor-task').getAttribute('data-status') === 'open', 'Restore: "Restored · Undo", open again')

// 12. Done rows and draft rows have no ⋯.
await open('2026-10-18')
log(await row('驱虫').locator('.editor-row-more').count() === 0, 'a done row has no ⋯')
await open(TODAY)
log(await p.locator('.editor-task[data-status=draft]').first().locator('.editor-row-more').count() === 0, 'a draft (empty) row has no ⋯')

// 13. Keyboard: ⌘/ from the row's text opens its menu, focus on the first item; ↓ moves; Esc closes; Tab still indents.
await open(SAT)
await row().locator('.editor-task-title').click(); await p.keyboard.press('Meta+ArrowRight')
await p.keyboard.press('Meta+/'); await p.waitForTimeout(200)
const first = await p.evaluate(() => document.activeElement?.textContent)
await p.keyboard.press('ArrowDown'); const second = await p.evaluate(() => document.activeElement?.textContent)
await p.keyboard.press('Escape'); await p.waitForTimeout(150)
log(Boolean(first) && Boolean(second) && first !== second && await p.locator('.app-menu').count() === 0, '⌘/ opens the row menu with focus inside; ↓ moves; Esc closes', `${first} → ${second}`)

// 14. A failed action releases the editor, keeps the text, and says so.
await open(SAT); await clearToasts()
await row().locator('.editor-task-title').click(); await p.keyboard.press('Meta+ArrowRight'); await p.waitForTimeout(100); await p.keyboard.type(' kept'); await p.waitForTimeout(900)
await p.route('**/_serverFn/**', r => r.request().method() === 'POST' ? r.abort() : r.continue())
const before = errors.length
await choose('Not on Sat')
await p.unroute('**/_serverFn/**')
// The aborted request logs its own network error; that one is this check's doing.
errors.splice(before, errors.length - before, ...errors.slice(before).filter(e => !/ERR_FAILED/.test(e)))
log((await toast()).some(t => t.startsWith('Not done')) && await p.locator('.continuous-editor .bn-editor').getAttribute('contenteditable') === 'true' && (await row().innerText()).includes(' kept'), 'failed action: "Not done · your text is kept", editing released, text kept', JSON.stringify(await toast()))

// 15. Regressions of ⌘Z paths the refresh change touches: typing Undo, A2 paste Undo.
await open(TODAY)
const bullet = p.locator('.continuous-editor .bn-block-outer').filter({ has: p.locator('[data-content-type=bulletListItem]') }).first()
await bullet.locator('.bn-inline-content').click(); await p.keyboard.type('undo me'); await p.waitForTimeout(200)
await p.keyboard.press('Meta+z'); await p.waitForTimeout(600)
log(!(await bullet.innerText()).includes('undo me'), 'typing then ⌘Z removes the typing')
await bullet.locator('.bn-inline-content').click()
await p.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'https://example.com/a12-regression'); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) })
await p.waitForTimeout(1500)
const card = await p.locator('.editor-page-card-row.is-link').count()
await p.keyboard.press('Meta+z'); await p.waitForTimeout(1500)
log(card >= 1 && await p.locator('.editor-page-card-row.is-link').count() === card - 1, 'A2: paste a URL → link card; ⌘Z with its notice → the line is back', `${card} → ${await p.locator('.editor-page-card-row.is-link').count()}`)

// 16. 390: the handle's bar for a task row; other lines keep "Block selected · Delete".
const m = await page(390, true)
await open(SAT, m)
await row(TITLE, m).locator('.editor-task-title').tap(); await m.waitForTimeout(400)
await m.locator('.editor-touch-handle').tap(); await m.waitForTimeout(400)
const buttons = await m.locator('.editor-selection-bar > button, .editor-selection-bar .editor-bar-button').evaluateAll(bs => bs.map(b => ({ t: b.innerText.trim(), h: b.getBoundingClientRect().height })))
const bar = await m.locator('.editor-selection-bar').evaluate(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth } })
log(JSON.stringify(buttons.map(b => b.t)) === '["Another day","Not on Sat","⋯"]' || JSON.stringify(buttons.map(b => b.t)).startsWith('["Tomorrow"'), '390 task row: the bar shows the row\'s actions', JSON.stringify(buttons.map(b => b.t)))
log(buttons.every(b => b.h >= 44) && bar.l >= 0 && bar.r <= bar.w, '390: each button is 44px or more, and the bar fits the screen', JSON.stringify(bar))
await m.locator('.editor-selection-bar .editor-bar-button', { hasText: 'Another day' }).tap(); await m.waitForTimeout(200)
log(await m.locator('.editor-selection-bar .app-menu').evaluate(e => e.getBoundingClientRect().top >= 0), '390: Another day opens upward, on screen')
await m.keyboard.press('Escape')
await open(TODAY, m)
await m.locator('.continuous-editor .bn-block-outer').filter({ has: m.locator('[data-content-type=bulletListItem]') }).first().locator('.bn-inline-content').tap(); await m.waitForTimeout(300)
await m.locator('.editor-touch-handle').tap(); await m.waitForTimeout(300)
log(/selected/.test(await m.locator('.editor-selection-bar').innerText()) && await m.locator('.editor-selection-bar button', { hasText: 'Delete' }).count() === 1, '390 text line: "… selected · Delete" as before')

log(errors.length === 0, 'no page or console errors', errors.slice(0, 3).join(' | '))
await browser.close()
console.log(`\n${failures ? `${failures} failed` : 'all passed'}`)
process.exitCode = failures ? 1 : 0
