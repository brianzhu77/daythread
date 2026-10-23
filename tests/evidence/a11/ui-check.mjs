// A11 browser check (docs/plan/a11-line-links.md §8, Jazz line-links-states §7). Built server, sign-in off, a COPY of
// the data with tests/evidence/a11/seed.ts applied (one fresh copy per run: the checks edit, cut and drag):
//   DB=<the server's SQLite path> node tests/evidence/a11/ui-check.mjs <base> <width> [touch]
// tests/evidence/a11/run-all.sh runs the three targets (1280, 390, 390 touch), each on its own copy.
// Every name below is one assertion group from §8; "ok"/"FAIL" lines are the evidence. Saved state (refIds, lineIds,
// Linked from times) is read from the database before and after a reload.
import { chromium } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

const DB = process.env.DB
if (!DB) { console.error('Set DB to the server\'s SQLite path (the seeded copy).'); process.exit(2) }
const M = JSON.parse(readFileSync(`${DB}.a11.json`, 'utf8'))
const [BASE, W, mode] = process.argv.slice(2), width = Number(W ?? 1280), touch = mode === 'touch'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width, height: 900 }, ...(touch ? { hasTouch: true, isMobile: true } : {}) })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
// Every tint from the moment a document loads, so a jump that tints before the check looks is still seen.
await ctx.addInitScript(() => {
  window.__flashed = new Set()
  new MutationObserver(list => { for (const m of list) if (m.target.classList?.contains('block-flash')) window.__flashed.add(m.target.getAttribute('data-id')) })
    .observe(document, { attributes: true, attributeFilter: ['class'], subtree: true })
})
const p = await ctx.newPage()
const errors = []
p.on('pageerror', e => errors.push(e.message))
let failed = 0, group = ''
const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}${touch ? ' touch' : ''} · ${group}: ${what}${d ? ` (${d})` : ''}`) }
const named = name => { group = name }
const wait = ms => p.waitForTimeout(ms)
const tap = async loc => touch ? loc.tap() : loc.click()
// End of line: on macOS, End scrolls the page instead of moving the caret.
const lineEnd = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'
const goto = async path => { await p.goto(BASE + path, { waitUntil: 'networkidle' }); await wait(700) }
const block = id => p.locator(`[data-node-type="blockContainer"][data-id="${id}"]`).first()
const chipIn = id => block(id).locator('.line-ref').first()
/** A chip's text, with its non-breaking space read as a space. */
const chipText = async loc => (await loc.textContent())?.replace(/\u00a0/g, ' ')
const toast = text => p.locator('[data-slot="toast"], [role="alert"], [role="status"]', { hasText: text })
const clipText = () => p.evaluate(() => navigator.clipboard.readText())
const pagePath = id => `/pages?page=${encodeURIComponent(id)}`
const lineUrl = (pageId, lineId, taskId) => `${BASE}/pages?${new URLSearchParams({ page: pageId, block: lineId, ...(taskId ? { task: taskId } : {}) })}`
/** Saved refs of a page, from the database: [refId, lineId, taskId, at] per link. */
const savedRefs = pageId => { const db = new DatabaseSync(DB, { readOnly: true }); try {
  const row = db.prepare("SELECT sections FROM pages WHERE snapshot='current' AND id=?").get(pageId)
  return row ? JSON.parse(String(row.sections)).flatMap(s => [...(s.refs ?? []), ...s.blocks.flatMap(x => x.refs ?? [])]).map(r => [r.refId, r.lineId ?? null, r.taskId ?? null, r.at ?? null]) : []
} finally { db.close() } }
/** Where the jump puts a line: about a third from the top of the visible area, clear of the bars, tinted, not focused. */
async function landed(id, what) {
  const container = p.locator(`[data-node-type="blockContainer"][data-id="${id}"]`)
  const el = (await container.count()) ? container.first() : p.locator(`[data-id="${id}"]`).first()
  const tinted = await p.waitForFunction(i => window.__flashed?.has(i), id, { timeout: 2500 }).then(() => true, () => false)
  await p.evaluate(i => window.__flashed?.delete(i), id)
  await wait(500)
  const g = await el.evaluate(e => {
    const r = e.getBoundingClientRect(), tab = document.querySelector('.tab-bar'), tabTop = tab && getComputedStyle(tab).display !== 'none' ? tab.getBoundingClientRect().top : innerHeight
    const bar = document.querySelector('.day-screen .capture-bar'), barBottom = bar && getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().bottom : 0
    const active = document.activeElement
    return { top: r.top, bottom: r.bottom, h: innerHeight, tabTop, barBottom, focused: Boolean(active?.closest?.('[contenteditable="true"]')) }
  }).catch(() => null)
  if (!g) return log(false, `${what}: the line is on the page`)
  const third = g.top / g.h
  log(tinted, `${what}: tinted`)
  log(third > 0.12 && third < 0.45, `${what}: about a third from the top`, `top ${Math.round(g.top)} of ${g.h}`)
  log(g.top >= g.barBottom && g.bottom <= g.tabTop - 60, `${what}: clear of the top bar and the bottom bar's fade`, `top ${Math.round(g.top)}, bar ${Math.round(g.barBottom)}, tab ${Math.round(g.tabTop)}`)
  log(!g.focused, `${what}: nothing focused`)
}
/** Puts the caret at the end of a line's text. */
async function caretEnd(id) {
  // At the line's left edge: its middle may be a chip, which a click would open.
  const inline = block(id).locator('.bn-inline-content').first(); await inline.scrollIntoViewIfNeeded()
  const box = await inline.boundingBox()
  if (touch) await p.touchscreen.tap(box.x + 2, box.y + box.height / 2); else await p.mouse.click(box.x + 2, box.y + box.height / 2)
  await wait(150)
  await p.keyboard.press(lineEnd); await wait(100)
}
/** Selects one line with its handle (desktop: the side-menu grip; phone: the touch handle). */
async function selectWithHandle(id) {
  // Below 900px the editor shows the phone's handle by the caret's line, with or without touch.
  if (touch || width < 900) { await caretEnd(id); await wait(150); await tap(p.locator('.editor-touch-handle')); await wait(300); return }
  await block(id).scrollIntoViewIfNeeded(); await p.mouse.move(1, 1); await wait(100)
  await block(id).locator('.bn-inline-content').first().hover(); await wait(300)
  await p.locator('.bn-side-menu [aria-label^="Select or drag"]').first().click(); await wait(300)
}
/** Records what the next paste event carries. */
const watchPaste = () => p.evaluate(() => { window.__pasteTypes = null; document.addEventListener('paste', e => { window.__pasteTypes = [...(e.clipboardData?.types ?? [])] }, { capture: true, once: true }) })
/** Pastes the clipboard on a new line after `afterId` on the open page; returns the new block's chips' text. */
async function pasteAfter(afterId, prefix = 'p ') {
  await caretEnd(afterId); await p.keyboard.press('Enter'); await p.keyboard.type(prefix); await watchPaste()
  await p.keyboard.press('ControlOrMeta+v'); await wait(1600)
}
const lastLineChips = () => p.evaluate(() => { const empty = document.querySelector('[data-node-type="blockOuter"][data-id="a11-src-page"]'); const last = empty?.nextElementSibling?.querySelector('[data-node-type="blockContainer"]'); return { text: last?.querySelector('.bn-inline-content')?.textContent ?? '', chips: [...(last?.querySelectorAll('.line-ref') ?? [])].map(c => c.textContent.replace(/\u00a0/g, ' ')), cards: document.querySelectorAll('[data-content-type="pageLink"]').length } })

// ------------------------------------------------------------------ copy: three entry points
named('copy: three entry points')
await goto(pagePath(M.pages.target))
if (!touch) {
  await caretEnd('a11-line'); await p.keyboard.press('ControlOrMeta+/'); await wait(300)
  log(await p.locator('.line-menu [role=menuitem]', { hasText: 'Copy link to line' }).count() === 1, '⌘/ on a line opens its menu with Copy link to line')
  await p.locator('.line-menu [role=menuitem]').click(); await wait(400)
  log(await toast('Link to line copied').count() > 0, '⌘/: "Link to line copied"')
  log(await clipText() === lineUrl(M.pages.target, 'a11-line'), '⌘/: the clipboard text is the line URL', await clipText())
  // Placement (Jazz states §1): under the line's box at its text start; above it when there's no room below.
  const placement = () => p.evaluate(() => {
    const m = document.querySelector('.line-menu')?.getBoundingClientRect()
    return m ? { top: m.top, bottom: m.bottom, left: m.left, h: innerHeight } : null
  })
  const lineBox = id => block(id).evaluate(e => { const c = e.querySelector('.bn-block-content').getBoundingClientRect(), t = e.querySelector('.bn-inline-content').getBoundingClientRect(); return { top: c.top, bottom: c.bottom, left: t.left } })
  await caretEnd('a11-fill-3'); const fill = await lineBox('a11-fill-3'); await p.keyboard.press('ControlOrMeta+/'); await wait(300)
  let m = await placement()
  log(m && m.top >= fill.bottom - 1 && Math.abs(m.left - fill.left) <= 1 && m.bottom <= m.h, '⌘/ menu: under its line, at the text start', JSON.stringify({ m, fill }))
  await p.keyboard.press('Escape'); await wait(200)
  // A line far enough down the page that it can sit at the bottom of the window.
  await caretEnd('a11-tail-5'); await p.evaluate(() => { const r = document.querySelector('[data-node-type="blockContainer"][data-id="a11-tail-5"]').getBoundingClientRect(); window.scrollBy(0, r.bottom - (innerHeight - 12)) }); await wait(200)
  const low = await lineBox('a11-tail-5'); await p.keyboard.press('ControlOrMeta+/'); await wait(300)
  m = await placement()
  log(m && m.bottom <= low.top + 1 && m.top >= 0, '⌘/ menu on a line at the bottom of the screen: above the line, fully in view', JSON.stringify({ m, low }))
  await p.keyboard.press('Escape'); await wait(200)
  await caretEnd('a11-heading'); await p.keyboard.press('ControlOrMeta+/'); await wait(300)
  log(await p.locator('.line-menu').count() === 1, '⌘/ on a custom heading offers it'); await p.keyboard.press('Escape'); await wait(200)
}
await selectWithHandle('a11-long')
const bar = p.locator('.editor-selection-bar')
log(await bar.locator('button', { hasText: 'Copy link' }).count() === 1, 'selection bar with one line: Copy link')
await bar.locator('button', { hasText: 'Copy link' }).click(); await wait(400)
log(await clipText() === lineUrl(M.pages.target, 'a11-long'), 'selection bar: the clipboard text is the line URL')
// The task menu: the ⋯ on desktop, the handle's bar (More actions) on the phone. Last, under a divider.
await goto(`/day/${M.today}`)
if (touch) {
  await selectWithHandle(M.rows.todayRow)
  await p.locator('.editor-selection-bar [aria-label="More actions"]').tap(); await wait(300)
} else {
  await block(M.rows.todayRow).locator('.editor-task-title').hover(); await wait(200)
  await block(M.rows.todayRow).locator('.editor-row-more').click(); await wait(300)
}
const groups = await p.locator('.app-menu .menu-group').evaluateAll(gs => gs.map(g => [...g.querySelectorAll('[role^=menuitem]')].map(i => i.textContent)))
const where = groups.findIndex(g => g.includes('Copy link to line'))
log(where >= 0 && groups[where].length === 1 && (touch ? where >= groups.length - 2 : where === groups.length - 1), 'task menu: Copy link to line in its own group, last (before Delete line on the phone)', JSON.stringify(groups))
await p.locator('.app-menu [role^=menuitem]', { hasText: 'Copy link to line' }).click(); await wait(400)
log(await clipText() === lineUrl(M.pages.today, M.rows.todayRow, M.tasks.past), 'task: the URL carries task=', await clipText())
// Template headings: no menu, nothing written.
if (!touch) {
  await p.evaluate(() => navigator.clipboard.writeText('unchanged'))
  const notes = p.locator('h2', { hasText: 'Notes' }).first(); await tap(notes); await p.keyboard.press(lineEnd); await p.keyboard.press('ControlOrMeta+/'); await wait(300)
  log(await p.locator('.line-menu').count() === 0 && await clipText() === 'unchanged', 'template heading (Notes): no Copy link to line')
}

// ------------------------------------------------------------------ copy: clipboard fails
named('copy: clipboard fails')
await goto(pagePath(M.pages.target))
await p.evaluate(() => { document.execCommand = () => false; navigator.clipboard.writeText = () => Promise.reject(new Error('denied')) })
await selectWithHandle('a11-line'); await bar.locator('button', { hasText: 'Copy link' }).click(); await wait(500)
log(await toast("Couldn't copy").count() > 0, '"Couldn\'t copy"')
log(await toast('Link to line copied').count() === 0, 'no "copied" notice')

// ------------------------------------------------------------------ paste: line type / own URL / foreign URL
named('paste: line type / own URL / foreign URL')
await goto(pagePath(M.pages.target))
await selectWithHandle('a11-line'); await bar.locator('button', { hasText: 'Copy link' }).click(); await wait(400)
await goto(pagePath(M.pages.source))
await pasteAfter('a11-src-page')
let last = await lastLineChips()
const types = await p.evaluate(() => window.__pasteTypes)
log(last.chips.length === 1 && last.chips[0].startsWith('The linked line'), 'the copied line makes a chip', JSON.stringify(last.chips))
log(touch || (types ?? []).includes('application/x-daythread-line'), 'it carried the line type', JSON.stringify(types))
await p.evaluate(url => navigator.clipboard.writeText(url), lineUrl(M.pages.target, 'a11-heading'))
await pasteAfter('a11-src-page', 'q '); last = await lastLineChips()
log(last.chips.length === 1 && last.chips[0].startsWith('Reading'), 'an own-origin line URL makes a chip', JSON.stringify(last.chips))
const cardsBefore = last.cards
for (const [text, what] of [
  ['https://example.com/pages?page=a11-target&block=a11-line', 'another host'],
  [`${BASE}/pages?page=a11-target&block=a11-line&view=trash`, 'an unknown param'],
  [`${BASE}/pages?page=a11-target`, 'no block'],
  [`${BASE}/pages?page=a11 target&block=a11-line`, 'a malformed URL'],
]) {
  await p.evaluate(t => navigator.clipboard.writeText(t), text)
  await pasteAfter('a11-src-page', 'r '); last = await lastLineChips()
  log(last.chips.length === 0 && last.cards === cardsBefore, `${what}: no chip, no link card`, last.text)
}

// ------------------------------------------------------------------ paste: into a task title
named('paste: into a task title')
await goto(`/day/${M.today}`)
await p.evaluate(url => navigator.clipboard.writeText(url), lineUrl(M.pages.target, 'a11-line'))
await tap(block(M.rows.todayRow).locator('.editor-task-title')); await p.keyboard.press(lineEnd); await p.keyboard.type(' — ')
await p.keyboard.press('ControlOrMeta+v'); await wait(1500)
const title = await block(M.rows.todayRow).locator('.editor-task-title').textContent()
log(title.endsWith('— The linked line') && await block(M.rows.todayRow).locator('.line-ref, .page-ref').count() === 0, 'the line\'s words, as text', title)

// ------------------------------------------------------------------ chip and jump
named('chip and jump')
await goto(pagePath(M.pages.source))
const refsBefore = savedRefs(M.pages.source)
log(await chipText(chipIn('a11-src-line')) === 'The linked line · A11 target', 'chip: the line\'s words · its page', await chipText(chipIn('a11-src-line')))
await tap(chipIn('a11-src-line')); await p.waitForURL(u => u.searchParams.get('page') === M.pages.target)
await landed('a11-line', 'tap')
await p.goBack(); await p.waitForURL(u => u.searchParams.get('page') === M.pages.source); await wait(700)
log(await chipIn('a11-src-line').isVisible(), 'Back returns to the link')
await tap(chipIn('a11-src-line')); await p.waitForURL(u => u.searchParams.get('page') === M.pages.target)
await landed('a11-line', 'second tap')
await p.goBack(); await wait(800)
await chipIn('a11-src-line').focus(); await p.keyboard.press('Enter'); await p.waitForURL(u => u.searchParams.get('page') === M.pages.target, { timeout: 4000 }).catch(() => {})
log(new URL(p.url()).searchParams.get('page') === M.pages.target, 'keyboard: Enter on the chip opens it')
await p.goBack(); await wait(800)
// A link to a line on the page you're on jumps in place (no navigation), a second time too.
await goto(pagePath(M.pages.target))
await caretEnd('a11-tail-29'); await p.keyboard.press('Enter'); await p.evaluate(url => navigator.clipboard.writeText(url), lineUrl(M.pages.target, 'a11-fill-2'))
await p.keyboard.press('ControlOrMeta+v'); await wait(1500)
const here = p.locator('.line-ref', { hasText: 'Filler line 3' }).first()
const urlBefore = p.url()
await tap(here); await landed('a11-fill-2', 'same page')
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await wait(300)
await tap(here); await landed('a11-fill-2', 'same page, again')
log(p.url() === urlBefore, 'same page: no navigation')
await p.reload({ waitUntil: 'networkidle' }); await wait(700)
log(JSON.stringify(savedRefs(M.pages.source)) === JSON.stringify(refsBefore), 'after a reload: refIds, lineIds and times unchanged', JSON.stringify(savedRefs(M.pages.source).slice(0, 2)))

// ------------------------------------------------------------------ chip: Line not found
named('chip: Line not found')
await goto(pagePath(M.pages.source))
log(await chipText(chipIn('a11-src-deleted')) === 'Line not found · A11 deleted', '"Line not found · {page}"')
await tap(chipIn('a11-src-deleted')); await p.waitForURL(u => u.searchParams.get('page') === M.pages.gone); await wait(600)
log(await toast("Couldn't find that line").count() > 0, '"Couldn\'t find that line"')
log(await p.evaluate(() => scrollY) < 40, 'opens the page at the top')
await goto(pagePath(M.pages.source))
log(await chipText(chipIn('a11-src-missing')) === 'Page not found', '"Page not found"')
const before404 = p.url(); await tap(chipIn('a11-src-missing')); await wait(500)
log(p.url() === before404, '"Page not found": tapping does nothing')

// ------------------------------------------------------------------ chip: trashed page
named('chip: trashed page')
const trashed = chipIn('a11-src-trashed')
const look = await trashed.evaluate(e => { const probe = document.createElement('span'); probe.style.color = 'var(--ink-3)'; document.body.append(probe); const ink3 = getComputedStyle(probe).color; probe.remove(); return { text: e.textContent.replace(/\u00a0/g, ' '), bin: Boolean(e.querySelector('.page-ref-icon svg path[d^="M5 7h14"]')), color: getComputedStyle(e).color, ink3 } })
log(look.text === 'On a trashed page · A11 trashed' && look.bin, 'its words · page, with the bin icon', look.text)
log(look.color === look.ink3, 'in --ink-3', `${look.color} / ${look.ink3}`)
await tap(trashed); await p.waitForURL(u => u.searchParams.get('page') === M.pages.trash); await wait(500)
log(await p.locator('.trash-banner .restore-button').count() === 1, 'opens the trashed page with Restore')
await landed('a11-trash-line', 'trashed page')

// ------------------------------------------------------------------ URL: fresh view
named('URL: fresh view')
for (const [url, page, line, what] of [
  [lineUrl(M.pages.target, 'a11-line'), M.pages.target, 'a11-line', 'a plain line'],
  [lineUrl(M.pages.past, M.rows.pastRow, M.tasks.past), M.pages.today, M.rows.todayRow, 'a task linked on a past day (history row still there), with task='],
  [lineUrl(M.pages.past, M.rows.pastRow), M.pages.today, M.rows.todayRow, 'the same, without task='],
  [lineUrl(M.pages.today, M.rows.movingRow, M.tasks.moving), M.pages.tomorrow, M.rows.movedRow, 'a task moved to tomorrow'],
  [lineUrl('a11-trash-task', 'a11-trashed-task-row', M.tasks.past), M.pages.today, M.rows.todayRow, 'a task row on a trashed page, with task= (its task is planned today)'],
  [lineUrl('a11-trash-task', 'a11-trashed-task-row'), M.pages.today, M.rows.todayRow, 'the same, without task='],
  [lineUrl(M.pages.trash, 'a11-trash-line'), M.pages.trash, 'a11-trash-line', 'a plain line on a trashed page stays there'],
]) {
  const fresh = await b.newContext({ viewport: { width, height: 900 }, ...(touch ? { hasTouch: true, isMobile: true } : {}) })
  const q = await fresh.newPage()
  await q.goto(url, { waitUntil: 'networkidle' }); await q.waitForTimeout(1500)
  const at = new URL(q.url()), day = page.startsWith('day:') ? page.slice(4) : null
  const onPage = day ? at.pathname === `/day/${day}` : at.searchParams.get('page') === page
  const shown = await q.locator(`[data-id="${line}"]`).first().evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }).catch(() => false)
  log(onPage && shown, `${what}: lands where the chip does`, `${at.pathname}${at.search}`)
  await fresh.close()
}

// ------------------------------------------------------------------ tag on a task row in a document page
named('tags: the page the list names')
await goto('/tags/a11tag')
await tap(p.locator('.card-section', { hasText: 'A11 target' }).locator('.tag-block').first())
await p.waitForURL(u => u.searchParams.get('page') === M.pages.target || u.pathname.startsWith('/day/'), { timeout: 5000 }).catch(() => {})
await wait(800)
log(new URL(p.url()).searchParams.get('page') === M.pages.target, 'a tagged task row on a document page opens that page, though its task is planned today', new URL(p.url()).pathname + new URL(p.url()).search)
await landed('a11-tagged-row', 'tag jump')
// The same entry after its row is gone from that page: the jump follows the task to its day.
await goto(`/pages?page=${M.pages.target}&block=a11-tagged-gone&from=tags`); await wait(800)
log(new URL(p.url()).pathname === `/day/${M.today}`, 'a row that\'s gone follows its task', new URL(p.url()).pathname)
await landed(M.rows.taggedTodayRow, 'tag jump, row gone')

// ------------------------------------------------------------------ URL: lookup fails
named('URL: lookup fails')
{
  const fresh = await b.newContext({ viewport: { width, height: 900 }, ...(touch ? { hasTouch: true, isMobile: true } : {}) })
  await fresh.addInitScript(() => { window.__flashed = new Set(); new MutationObserver(l => { for (const x of l) if (x.target.classList?.contains('block-flash')) window.__flashed.add(x.target.getAttribute('data-id')) }).observe(document, { attributes: true, attributeFilter: ['class'], subtree: true }) })
  const q = await fresh.newPage(); let blocked = 0
  // The resolver's request only (a GET server function carrying lineId): 503, as when the server is unreachable.
  const deny = async r => { let u = r.request().url(); try { u = decodeURIComponent(u) } catch {} if (u.includes('_serverFn') && u.includes('lineId')) { blocked++; await r.fulfill({ status: 503, body: 'unavailable' }) } else await r.continue() }
  await q.route('**/*', deny)
  const url = lineUrl(M.pages.past, M.rows.pastRow, M.tasks.past)
  await q.goto(url, { waitUntil: 'networkidle' }); await q.waitForTimeout(900)
  const state = await q.evaluate(row => ({ tinted: window.__flashed.has(row), notice: document.body.innerText.includes("Couldn't check where that line is now"), y: scrollY, href: location.href }), M.rows.pastRow)
  log(blocked >= 1 && !state.tinted, 'no jump to the old row', `blocked ${blocked}`)
  log(state.notice, '"Couldn\'t check where that line is now"')
  log(state.href === url && state.y < 40, 'the URL\'s page at the top, the URL kept', state.href)
  await q.unroute('**/*', deny)
  await q.getByRole('button', { name: 'Retry' }).first().click(); await q.waitForTimeout(1500)
  const after = await q.evaluate(row => ({ path: location.pathname, tinted: window.__flashed.has(row) }), M.rows.todayRow)
  log(after.path === `/day/${M.today}` && after.tinted, 'Retry, once it answers: lands where the chip does', after.path)
  await fresh.close()
}

// ------------------------------------------------------------------ Linked from
named('Linked from')
await goto(pagePath(M.pages.target))
const linked = await p.locator('.linked-from a, .linked-from [href]').evaluateAll(as => as.map(a => a.textContent?.trim()))
log(linked.filter(t => t?.includes('A11 links')).length === 1, 'the linking page once (a page link and line links to it)', JSON.stringify(linked))
await goto(`/day/${M.tomorrow}`)
const linkedTomorrow = await p.locator('.linked-from a, .linked-from [href]').evaluateAll(as => as.map(a => a.textContent?.trim()))
log(linkedTomorrow.some(t => t?.includes('A11 links')), 'a moved task\'s link counts on its new day', JSON.stringify(linkedTomorrow))
const times = savedRefs(M.pages.source).filter(r => r[0] === M.refIds.moving)
log(times.length === 1 && times[0][3] !== null, 'with the link\'s own time', JSON.stringify(times))

// ------------------------------------------------------------------ long excerpt at 390
named('long excerpt at 390')
await goto(pagePath(M.pages.source))
const geo = await chipIn('a11-src-long').evaluate(e => {
  const r = e.getBoundingClientRect(), line = e.closest('.bn-inline-content').getBoundingClientRect(), words = e.querySelector('.line-ref-words'), where = e.querySelector('.line-ref-where')
  return { right: r.right, lineRight: line.right, height: r.height, lh: parseFloat(getComputedStyle(e).lineHeight) || 24, ellipsis: words.scrollWidth > words.clientWidth, whereWhole: where.scrollWidth <= where.clientWidth + 1 }
})
log(geo.right <= geo.lineRight + 1, 'no overflow', `${Math.round(geo.right)} ≤ ${Math.round(geo.lineRight)}`)
log(geo.height < geo.lh * 1.6, 'one line', `${geo.height}px`)
log(width > 600 || (geo.ellipsis && geo.whereWhole), 'the words end in an ellipsis; the place shows whole')

// ------------------------------------------------------------------ edit and task move
named('edit and task move')
await goto(pagePath(M.pages.target))
await caretEnd('a11-line'); await p.keyboard.type(' edited'); await wait(1600)
await goto(pagePath(M.pages.source)); await p.reload({ waitUntil: 'networkidle' }); await wait(700)
log((await chipText(chipIn('a11-src-line'))).startsWith('The linked line edited'), 'edit the line → the chip\'s words change after a reload')
const tomorrowLabel = new Date(`${M.tomorrow}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
log(await chipText(chipIn('a11-src-moving')) === `A11 moving task · ${tomorrowLabel}`, 'a task moved to tomorrow → the chip names that day', await chipText(chipIn('a11-src-moving')))
await tap(chipIn('a11-src-moving')); await p.waitForURL(u => u.pathname === `/day/${M.tomorrow}`)
await landed(M.rows.movedRow, 'moved task')

// ------------------------------------------------------------------ drag keeps the link
named('drag keeps the link')
if (width >= 900) {
  await goto(pagePath(M.pages.target))
  await block('a11-drag').scrollIntoViewIfNeeded(); await p.mouse.move(1, 1); await wait(100)
  await block('a11-drag').locator('.bn-inline-content').hover(); await wait(300)
  const grip = await p.locator('.bn-side-menu [aria-label^="Select or drag"]').first().boundingBox(), to = await block('a11-line').boundingBox()
  await p.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await p.mouse.down()
  await p.mouse.move(grip.x + grip.width / 2, grip.y - 10, { steps: 4 }); await p.mouse.move(to.x + 40, to.y + 3, { steps: 12 }); await wait(200)
  await p.mouse.up(); await wait(1600)
  const order = await p.evaluate(() => [...document.querySelectorAll('[data-node-type="blockContainer"][data-id^="a11-"]')].map(e => e.getAttribute('data-id')))
  log(order.indexOf('a11-drag') < order.indexOf('a11-line'), 'the line moved up the page', `${order.indexOf('a11-drag')}`)
  await goto(pagePath(M.pages.source)); await p.reload({ waitUntil: 'networkidle' }); await wait(700)
  log(await chipText(chipIn('a11-src-drag')) === 'A line to drag · A11 target', 'the chip still shows its words, not "Line not found"', await chipText(chipIn('a11-src-drag')))
} else console.log(`skip ${width}${touch ? ' touch' : ''} · ${group}: the desktop grip drag runs at 1280; a phone drag isn't driven here`)

// ------------------------------------------------------------------ chip: cut and paste
named('chip: cut and paste')
if (!touch) {
  await goto(pagePath(M.pages.target))
  await selectWithHandle('a11-cut'); await p.keyboard.press('ControlOrMeta+x'); await wait(1600)
  await goto(pagePath(M.pages.source)); await caretEnd('a11-src-page'); await p.keyboard.press('ControlOrMeta+v'); await wait(1600)
  await p.reload({ waitUntil: 'networkidle' }); await wait(700)
  log(await chipText(chipIn('a11-src-cut')) === 'Line not found · A11 target', 'a cut-and-pasted plain line → "Line not found · {page}" (v1)', await chipText(chipIn('a11-src-cut')))
  await goto(`/day/${M.today}`)
  await selectWithHandle(M.rows.todayRow); await p.keyboard.press('ControlOrMeta+x'); await wait(1600)
  await goto(pagePath(M.pages.target)); await caretEnd('a11-tail-0'); await p.keyboard.press('ControlOrMeta+v'); await wait(1600)
  await goto(pagePath(M.pages.source)); await p.reload({ waitUntil: 'networkidle' }); await wait(700)
  log((await chipText(chipIn('a11-src-pastTask'))).startsWith('A11 past task'), 'a cut-and-pasted task row → still followed by its task', await chipText(chipIn('a11-src-pastTask')))
} else console.log(`skip ${width} touch · ${group}: cut and paste by keyboard runs at 1280 and 390`)

// ------------------------------------------------------------------ copy: not offered
named('copy: not offered')
await goto(pagePath(M.pages.source))
if (!touch) {
  await p.evaluate(() => navigator.clipboard.writeText('unchanged'))
  await caretEnd('a11-src-page'); await p.keyboard.press('Enter'); await p.keyboard.press('ControlOrMeta+/'); await wait(300)
  log(await p.locator('.line-menu').count() === 0 && await clipText() === 'unchanged', 'an empty line: no menu, nothing written')
}
await goto(`/day/${M.today}`)
await selectWithHandle(M.rows.movingRow).catch(() => {})
// Two lines selected: extend a handle selection with Shift+↓ (desktop); the phone bar shows no Copy link for two.
await goto(pagePath(M.pages.target))
await selectWithHandle('a11-fill-0')
if (width >= 900) {
  await p.mouse.move(1, 1); await block('a11-fill-1').locator('.bn-inline-content').first().hover(); await wait(300)
  await p.locator('.bn-side-menu [aria-label^="Select or drag"]').first().click({ modifiers: ['Shift'] }); await wait(300)
}
const two = await p.locator('.editor-selection-bar').innerText().catch(() => '')
log(width < 900 || (/2 blocks selected/.test(two) && !two.includes('Copy link')), 'two lines selected: no Copy link', two.replace(/\n/g, ' '))

console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors')
console.log(failed ? `${failed} FAILED` : 'all passed')
await b.close()
process.exit(failed ? 1 : 0)
