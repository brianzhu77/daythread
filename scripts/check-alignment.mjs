// Geometry check for day-page rows: the standing rule for every visual change (Lead 4b3ce971, Ratchet 74c68e9d,
// checklist "How to update"). Read-only: it opens pages, hovers rows and measures; it never types or saves.
//
//   node scripts/check-alignment.mjs <base url> [path ...] [--all]
//   e.g. node scripts/check-alignment.mjs http://127.0.0.1:3361
//
// Run it against a build serving a SQLite copy with scripts/align-fixtures.ts applied (it adds every row type to
// /day/2026-12-31 and a line to today). On the test fixture (tests/fixtures/v1/workspace.sqlite), pass the paths:
//   node scripts/check-alignment.mjs <base url> /day/2026-10-21 /day/<today> /day/2026-12-31
// Paths default to Oct 18, Oct 19, today and 2026-12-31 (a copy of Brian's data). At 1280 and 390:
//   1. Columns. Each row against its own expected column:
//      - top-level rows (open/done/cancelled tasks, bullets, numbered lines, page and link cards, empty rows): one
//        shared text column, the one most rows use;
//      - a nested row: its parent's text column + 24px (B19: one step right of the parent's text); a nested task's
//        checkbox starts at its parent's text instead (B39, Notion's convention), so its text sits further in;
//      - headings, and a database table's title (styled as a section heading): the editor's own left edge.
//   2. Markers on the first text line: a task's checkbox (and its ⋯, labels and tags), a bullet's marker (top level and nested), a card's icon
//      and chevron, and (1280, hovered, one row per type) the drag handle, each centred on the row's first text line.
//      Bullet markers are measured as drawn (screenshot pixels in the zone left of the text), at every level, and
//      each nested marker's drawn size and gap to its text must match the top-level dot's within 1px.
//      A marker that can't be found is MISSING, never skipped.
//   The title's date picker: each day's dot centred under its number (within 1px) and below the digits.
//   Page card titles must wrap, not clip (link cards may end in an ellipsis).
//   Inline chips (A9a page links, A11 line links): the chip's height within its line's box, and its text on the same
//   baseline as the plain text beside it (Jazz line-links-states §7 check 10).
//   3. Coverage. Every row type in REQUIRED must appear on the measured pages; one that doesn't is MISSING, never a
//      pass. Add it to the data copy (or pass a fixture page) and run again.
// Tolerance is 1px on unrounded coordinates (output shows one decimal). Exit code 1 on any FAIL or MISSING.
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const [base, ...given] = args.filter(a => !a.startsWith('--'))
if (!base) { console.error('usage: node scripts/check-alignment.mjs <base url> [path ...] [--all]'); process.exit(2) }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const paths = given.length ? given : ['/day/2026-10-18', '/day/2026-10-19', `/day/${today}`, '/day/2026-12-31']
const TOLERANCE = 1, NEST_STEP = 24
const REQUIRED = ['heading', 'open task', 'done task', 'cancelled task', 'bullet', 'nested bullet', 'level 3 bullet', 'nested task', 'level 3 task', 'empty row', 'page card with preview', 'page card without preview', 'link card', 'line link', 'database table', 'picker dot on a plain day', 'picker dot on today', 'picker dot on the selected day']

function measure() {
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const cy = r => r.top + r.height / 2
  // The first text line of an element: its first line box, or for an empty row the line its caret would sit on.
  const firstLine = e => {
    const range = document.createRange(); range.selectNodeContents(e)
    const rect = [...range.getClientRects()].find(r => r.width > 0 && r.height > 0)
    const box = e.getBoundingClientRect(), style = getComputedStyle(e)
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2
    const lineTop = rect ? rect.top : box.top + parseFloat(style.paddingTop), lineBottom = rect ? rect.bottom : lineTop + lineHeight
    return { left: box.left + parseFloat(style.paddingLeft), cy: rect ? cy(rect) : lineTop + lineHeight / 2, lineTop, lineBottom }
  }
  const depth = e => { let d = 0; for (let g = e.closest('.bn-block-group'); g; g = g.parentElement?.closest('.bn-block-group')) d++; return d - 1 }
  const editor = document.querySelector('.continuous-editor .bn-editor')
  const editorLeft = editor ? editor.getBoundingClientRect().left + parseFloat(getComputedStyle(editor).paddingLeft) : null
  const rows = []
  const outers = [...document.querySelectorAll('.continuous-editor .bn-block-outer')]
  outers.forEach((outer, index) => {
    // React-rendered blocks (tasks, cards) wrap their content one level deeper than BlockNote's own.
    const content = [...outer.querySelectorAll('.bn-block-content')].find(c => c.closest('.bn-block-outer') === outer)
    if (!content || !visible(content)) return
    const type = content.getAttribute('data-content-type'), d = depth(outer)
    const text = content.innerText.trim().split('\n')[0] ?? ''
    const row = { index, depth: d, label: (text || '(empty)').slice(0, 24), parent: outers.indexOf(outer.parentElement?.closest('.bn-block-outer')), markers: {} }
    if (type === 'task') {
      const title = content.querySelector('.editor-task-title'), box = content.querySelector('.editor-task input')
      // The task's real state, set by the editor from the workspace (data-status), never inferred from styling.
      const status = content.querySelector('.editor-task')?.getAttribute('data-status') ?? 'unknown'
      Object.assign(row, { kind: `${status} task`, empty: !title.textContent.trim(), ...firstLine(title) })
      if (box && visible(box)) { row.markers.checkbox = cy(box.getBoundingClientRect()); row.boxLeft = box.getBoundingClientRect().left }
      // The row's other parts on its first line (A12): the ⋯ (laid out even while hidden), and the labels and tags.
      for (const [name, selector] of [['⋯ button', '.editor-row-more'], ['Cancelled label', '.editor-cancelled-tag'], ['reference tag', '.editor-reference-tag'], ['date tag', '.editor-date-tag'], ['Plan for today', '.editor-plan-action']]) {
        const part = content.querySelector(selector)
        if (part && visible(part)) row.markers[name] = cy(part.getBoundingClientRect())
      }
    } else if (type === 'pageLink') {
      const card = content.querySelector('.editor-page-card'), title = content.querySelector('.editor-page-card-title')
      if (!card || !title) return
      const link = Boolean(content.querySelector('.editor-page-card-row.is-link'))
      Object.assign(row, { kind: link ? 'link card' : content.querySelector('.editor-page-card-preview') ? 'page card with preview' : 'page card without preview', ...firstLine(title) })
      // A page card's title wraps; only a link card's one line may end in an ellipsis (A2). Clipped text fails.
      row.clipped = !link && title.scrollWidth > title.clientWidth + 1 ? `${title.scrollWidth}px of text in ${title.clientWidth}px` : null
      const icon = card.querySelector('.editor-page-card-icon'), chevron = card.querySelector(':scope > svg')
      if (icon && visible(icon)) row.markers.icon = cy(icon.getBoundingClientRect())
      if (chevron && visible(chevron)) row.markers.chevron = cy(chevron.getBoundingClientRect())
    } else if (type === 'bulletListItem' || type === 'numberedListItem' || type === 'paragraph') {
      const inline = content.querySelector('.bn-inline-content')
      const list = type === 'bulletListItem' ? 'bullet' : 'numbered'
      Object.assign(row, { kind: type === 'paragraph' ? 'paragraph' : d > 0 ? `nested ${list}` : list, empty: !text, ...firstLine(inline) })
      // Bullets: the marker is measured from pixels later (drawPass), in the zone left of the text on the first line,
      // so a dot, a ring or a glyph is measured as drawn. Its centre must sit on the first line, and at every level its
      // size and gap to the text must match the top-level dot's (Lead b51edfe5).
      if (type === 'bulletListItem') row.zone = { left: content.getBoundingClientRect().left, right: row.left, top: row.lineTop, bottom: row.lineBottom }
    } else if (type === 'heading') {
      Object.assign(row, { kind: 'heading', ...firstLine(content.querySelector('.bn-inline-content')) })
    } else if (type === 'database') {
      // Databases (design §15): the title on the row column (as any top-level row), the view's chevron centred on its
      // word, and `+ New` on Name's text. Only a home block draws a table; any other is a page card, not measured here.
      const title = content.querySelector('.database-title')
      if (!title) return
      Object.assign(row, { kind: 'database table', label: (title.value || '(untitled)').slice(0, 24), ...firstLine(title) })
      const view = content.querySelector('.database-view-name'), chevron = view?.querySelector('svg')
      if (view && chevron && visible(chevron)) {
        const range = document.createRange(); range.selectNodeContents(view.firstChild ?? view)
        const word = [...range.getClientRects()].find(r => r.width > 0)
        if (word) row.viewChevron = cy(chevron.getBoundingClientRect()) - cy(word)
      } else row.viewChevron = null
      const name = content.querySelector('.database-title-cell > span'), add = content.querySelector('.database-new')
      if (name && add) {
        const r = document.createRange(); r.selectNodeContents(name); const nameText = [...r.getClientRects()].find(x => x.width > 0)
        const a = document.createRange(); a.selectNodeContents(add); const addText = [...a.getClientRects()].find(x => x.width > 0)
        row.newOnName = nameText && addText ? addText.left - nameText.left : null
      } else row.newOnName = null
    } else return
    rows.push(row)
  })
  // Inline chips, measured against plain text on the same line of the same row.
  const chips = []
  for (const chip of document.querySelectorAll('.continuous-editor .bn-inline-content .page-ref')) {
    if (!visible(chip)) continue
    const inline = chip.closest('.bn-inline-content'), words = chip.querySelector('.line-ref-words, .page-ref-title')
    const range = document.createRange(); range.selectNodeContents(words ?? chip)
    const own = [...range.getClientRects()].find(r => r.width > 0 && r.height > 0)
    const box = chip.getBoundingClientRect(), lineHeight = parseFloat(getComputedStyle(inline).lineHeight) || parseFloat(getComputedStyle(inline).fontSize) * 1.2
    // Plain text of the same row: on the chip's own line if there is some; else on another line, compared by where the
    // text sits inside its line box (a chip that wrapped onto a line of its own).
    const top = inline.getBoundingClientRect().top + parseFloat(getComputedStyle(inline).paddingTop)
    const inLine = r => r.bottom - (top + Math.floor((cy(r) - top) / lineHeight) * lineHeight)
    let beside = null, other = null
    const walker = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n && !beside; n = walker.nextNode()) {
      if (chip.contains(n) || n.parentElement?.closest('.page-ref') || !n.textContent.trim()) continue
      const r = document.createRange(); r.selectNodeContents(n)
      for (const x of r.getClientRects()) if (x.width > 0 && own) { if (Math.abs(cy(x) - cy(own)) < own.height / 2) beside = x; else other ??= x }
    }
    const baseline = !own ? null : beside ? own.bottom - beside.bottom : other ? inLine(own) - inLine(other) : null
    chips.push({ kind: chip.classList.contains('line-ref') ? 'line link' : 'page link', label: chip.textContent.trim().slice(0, 24), height: box.height, lineHeight, baseline, across: !beside && Boolean(other) })
  }
  return { rows, editorLeft, chips }
}

const fmt = n => (Math.round(n * 10) / 10).toFixed(1)
/**
 * Bullet markers as drawn: a screenshot of the page, read back through a canvas, and in each bullet's marker zone the
 * box of pixels that differ from the zone's background. Gives the marker's drawn size, centre and gap to the text.
 */
async function drawPass(page, rows) {
  const bullets = rows.filter(r => r.zone && r.zone.right - r.zone.left > 2)
  if (!bullets.length) return
  // Fixed and sticky layers (phone toolbar, handle, + button, header) land on rows in a full-page capture: hide them.
  await page.evaluate(() => { for (const e of document.querySelectorAll('body *')) { const p = getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') e.setAttribute('data-align-hidden', e.style.visibility || ' '), e.style.visibility = 'hidden' } })
  const png = await page.screenshot({ fullPage: true })
  await page.evaluate(() => { for (const e of document.querySelectorAll('[data-align-hidden]')) { e.style.visibility = e.getAttribute('data-align-hidden').trim(); e.removeAttribute('data-align-hidden') } })
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }))
  const reader = await browser.newPage()
  const boxes = await reader.evaluate(async ({ data, zones }) => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0)
    return zones.map(z => {
      const x0 = Math.floor(z.left), x1 = Math.ceil(z.right), y0 = Math.floor(z.top), y1 = Math.ceil(z.bottom)
      if (x1 <= x0 || y1 <= y0) return null
      const { data: px } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0), w = x1 - x0
      const bg = [px[0], px[1], px[2]]
      let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1
      for (let i = 0; i < px.length; i += 4) {
        if (Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2])) < 48) continue
        const x = (i / 4) % w, y = Math.floor(i / 4 / w)
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
      return maxX < 0 ? null : { left: x0 + minX, right: x0 + maxX + 1, top: y0 + minY, bottom: y0 + maxY + 1 }
    })
  }, { data: png.toString('base64'), zones: bullets.map(r => ({ left: r.zone.left + scroll.x, right: r.zone.right + scroll.x, top: r.zone.top + scroll.y, bottom: r.zone.bottom + scroll.y })) })
  await reader.close()
  bullets.forEach((r, i) => {
    const b = boxes[i]
    if (!b) { r.markers.dot = null; return }
    r.drawn = { size: Math.max(b.right - b.left, b.bottom - b.top), gap: r.left + scroll.x - b.right }
    r.markers.dot = (b.top + b.bottom) / 2 - scroll.y
  })
}
const browser = await chromium.launch()
const results = [], seen = new Map()
for (const [width, height] of [[1280, 900], [390, 844]]) {
  seen.set(width, new Set())
  for (const path of paths) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000)
    const { rows, editorLeft, chips } = await page.evaluate(measure)
    await drawPass(page, rows)
    // The drag handle shows on hover (desktop only): hover one row of each kind and measure it there.
    if (width === 1280) {
      const sampled = new Set()
      for (const row of rows) {
        if (sampled.has(row.kind) || row.kind === 'paragraph') continue
        sampled.add(row.kind)
        const outer = page.locator('.continuous-editor .bn-block-outer').nth(row.index)
        await outer.scrollIntoViewIfNeeded().catch(() => undefined)
        await outer.hover({ position: { x: 60, y: 6 } }).catch(() => undefined); await page.waitForTimeout(200)
        const after = await page.evaluate(i => {
          const outer = document.querySelectorAll('.continuous-editor .bn-block-outer')[i]
          const content = [...outer.querySelectorAll('.bn-block-content')].find(c => c.closest('.bn-block-outer') === outer)
          const text = content?.querySelector('.editor-task-title, .editor-page-card-title, .bn-inline-content, .database-title')
          if (!text) return null
          const range = document.createRange(); range.selectNodeContents(text)
          const line = [...range.getClientRects()].find(r => r.width > 0 && r.height > 0)
          // An empty row has no line box: use the line its caret would sit on, as measure() does.
          const box = text.getBoundingClientRect(), style = getComputedStyle(text)
          const cy = line ? line.top + line.height / 2 : box.top + parseFloat(style.paddingTop) + (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2) / 2
          const h = document.querySelector('.editor-handle svg'), r = h?.getBoundingClientRect()
          return r?.width ? { handle: r.top + r.height / 2, cy } : null
        }, row.index)
        // Hovering scrolls the page, so the handle is compared with the row measured at the same moment. No handle
        // found on hover is reported as MISSING, not skipped.
        row.hovered = after?.cy != null ? after : { missing: true }
      }
    }
    // The title's date picker (Brian a6bd90e4): a day's dot sits centred under its number, below the digits.
    await page.locator('.day-title-trigger').click().catch(() => undefined); await page.waitForTimeout(300)
    const dots = await page.evaluate(() => [...document.querySelectorAll('.day-picker .calendar__cell')].flatMap(c => {
      const dot = c.querySelector('.day-picker-dot'); if (!dot) return []
      const range = document.createRange(); range.selectNodeContents(c.firstChild ?? c); const t = range.getBoundingClientRect(), d = dot.getBoundingClientRect(), cell = c.getBoundingClientRect()
      // Contrast of the dot against its own cell, from computed colours: the dot's colour at its opacity composited over
      // the cell's fill (or the popover's when the cell has none). DPR-independent, unlike reading 3px of anti-aliasing.
      const rgba = css => { const k = document.createElement('canvas').getContext('2d'); k.fillStyle = '#000'; k.fillStyle = css; k.fillRect(0, 0, 1, 1); const [r, g, b, a] = k.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255] }
      const over = (top, under) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3]))
      let under = [255, 255, 255]
      for (let e = c.parentElement, stack = []; e; e = e.parentElement) { const bg = rgba(getComputedStyle(e).backgroundColor); if (bg[3] > 0) { stack.push(bg); if (bg[3] >= 1) { under = stack.reverse().reduce((u, l) => over(l, u), [255, 255, 255]); break } } }
      const cellBg = over(rgba(getComputedStyle(c).backgroundColor), under)
      const ds = getComputedStyle(dot), dc = rgba(ds.backgroundColor), dotRgb = over([dc[0], dc[1], dc[2], dc[3] * parseFloat(ds.opacity)], cellBg)
      const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
      const [hi, lo] = [lum(dotRgb), lum(cellBg)].sort((a, b) => b - a)
      const kind = c.getAttribute('data-selected') === 'true' ? 'selected' : c.getAttribute('data-today') === 'true' ? 'today' : 'plain'
      return [{ day: c.textContent.trim(), dx: (d.left + d.right) / 2 - (cell.left + cell.right) / 2, below: d.top >= t.bottom - 0.5, size: d.width, contrast: (hi + 0.05) / (lo + 0.05), kind }]
    }))
    await page.keyboard.press('Escape').catch(() => undefined)
    await page.close()
    const at = `${width} ${path}`
    for (const d of dots) results.push({ at, check: `picker dot under day ${d.day}`, ok: Math.abs(d.dx) <= TOLERANCE && d.below, detail: `${d.dx >= 0 ? '+' : ''}${fmt(d.dx)}px from centre, ${d.below ? 'below the digits' : 'overlapping the digits'}, ${fmt(d.size)}px` })
    // A dot is a non-text graphic: at least 3:1 against its own cell, on plain, today and selected cells (Lead f5c37a18).
    for (const d of dots) results.push({ at, check: `picker dot contrast on day ${d.day} (${d.kind})`, ok: d.contrast >= 3, detail: `${fmt(d.contrast)}:1 against its cell` })
    for (const d of dots) seen.get(width).add(d.kind === 'plain' ? 'picker dot on a plain day' : d.kind === 'today' ? 'picker dot on today' : 'picker dot on the selected day')
    for (const c of chips) {
      seen.get(width).add(c.kind)
      results.push({ at, check: `${c.kind} height within the line box: "${c.label}"`, ok: c.height <= c.lineHeight + TOLERANCE, detail: `${fmt(c.height)}px in a ${fmt(c.lineHeight)}px line` })
      results.push(c.baseline === null
        ? { at, check: `${c.kind} baseline: "${c.label}"`, ok: 'missing', detail: 'no plain text beside it on the line, so not measured' }
        : { at, check: `${c.kind} text baseline on the line's: "${c.label}"`, ok: Math.abs(c.baseline) <= TOLERANCE, detail: `${c.baseline >= 0 ? '+' : ''}${fmt(c.baseline)}px${c.across ? ' (against text on another line of the row, within its line box)' : ''}` })
    }
    for (const r of rows) { seen.get(width).add(r.kind); if (r.empty) seen.get(width).add('empty row'); if (r.kind === 'nested bullet' && r.depth >= 2) seen.get(width).add('level 3 bullet'); if (r.kind.endsWith(' task') && r.depth >= 1) seen.get(width).add(r.depth >= 2 ? 'level 3 task' : 'nested task'); if (r.kind.endsWith(' task') && r.depth >= 2) seen.get(width).add('nested task') }
    // 1. Columns.
    const top = rows.filter(r => r.depth === 0 && r.kind !== 'heading' && r.kind !== 'paragraph')
    const counts = new Map(); for (const r of top) { const x = Math.round(r.left); counts.set(x, (counts.get(x) ?? 0) + 1) }
    const usual = counts.size ? [...counts].sort((a, b) => b[1] - a[1])[0][0] : null
    const column = usual === null ? null : top.find(r => Math.round(r.left) === usual).left
    for (const r of rows) {
      let expected = null, rule = '', x = r.left, what = 'text'
      // A database's title is styled as a section heading (design §4.1), so it shares the headings' edge.
      if (r.kind === 'heading' || r.kind === 'database table') { expected = editorLeft; rule = 'editor edge' }
      else if (r.kind === 'paragraph') continue
      else if (r.depth > 0) {
        const parent = rows.find(p => p.index === r.parent); if (!parent) continue
        if (r.boxLeft !== undefined) { x = r.boxLeft; what = 'checkbox'; expected = parent.left; rule = "parent's text" }
        else { expected = parent.left + NEST_STEP; rule = `parent ${fmt(parent.left)} + ${NEST_STEP}` }
      }
      else { expected = column; rule = 'row column' }
      if (expected === null) continue
      const off = x - expected
      results.push({ at, check: `${r.kind} ${what} x: "${r.label}"`, ok: Math.abs(off) <= TOLERANCE, detail: `x=${fmt(x)}, expected ${fmt(expected)} (${rule}), off ${off >= 0 ? '+' : ''}${fmt(off)}` })
    }
    for (const r of rows) if (r.clipped !== undefined && !r.kind.startsWith('link'))
      results.push({ at, check: `${r.kind} title not clipped: "${r.label}"`, ok: !r.clipped, detail: r.clipped ?? 'wraps' })
    // The database block's own columns (design §15).
    for (const r of rows.filter(r => r.kind === 'database table')) {
      results.push(r.viewChevron == null
        ? { at, check: `database view chevron: "${r.label}"`, ok: 'missing', detail: 'not found, so not measured' }
        : { at, check: `database view chevron centred on its word: "${r.label}"`, ok: Math.abs(r.viewChevron) <= TOLERANCE, detail: `${r.viewChevron >= 0 ? '+' : ''}${fmt(r.viewChevron)}px` })
      results.push(r.newOnName == null
        ? { at, check: `database + New: "${r.label}"`, ok: 'missing', detail: 'no row or no + New, so not measured' }
        : { at, check: `database + New on Name's text: "${r.label}"`, ok: Math.abs(r.newOnName) <= TOLERANCE, detail: `${r.newOnName >= 0 ? '+' : ''}${fmt(r.newOnName)}px` })
    }
    // 2. Markers on the first text line.
    for (const r of rows) {
      const markers = Object.entries(r.markers).map(([m, y]) => [m, y === null ? null : y - r.cy])
      if (r.hovered) markers.push(['handle', r.hovered.missing ? null : r.hovered.handle - r.hovered.cy])
      for (const [marker, off] of markers)
        results.push(off === null
          ? { at, check: `${r.kind} ${marker}: "${r.label}"`, ok: 'missing', detail: 'not found, so not measured' }
          : { at, check: `${r.kind} ${marker} on first line: "${r.label}"`, ok: Math.abs(off) <= TOLERANCE, detail: `${off >= 0 ? '+' : ''}${fmt(off)}px` })
    }
    // Every bullet marker against the top-level dot on the same page: drawn size within 1px, gap to text within 1px.
    const tops = rows.filter(r => r.drawn && r.depth === 0)
    if (tops.length) {
      const median = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]
      const ref = { size: median(tops.map(r => r.drawn.size)), gap: median(tops.map(r => r.drawn.gap)) }
      for (const r of rows.filter(r => r.drawn && r.depth > 0)) {
        results.push({ at, check: `level ${r.depth + 1} bullet marker size vs top level: "${r.label}"`, ok: Math.abs(r.drawn.size - ref.size) <= TOLERANCE, detail: `${fmt(r.drawn.size)}px vs ${fmt(ref.size)}px` })
        results.push({ at, check: `level ${r.depth + 1} bullet marker gap to text vs top level: "${r.label}"`, ok: Math.abs(r.drawn.gap - ref.gap) <= TOLERANCE, detail: `${fmt(r.drawn.gap)}px vs ${fmt(ref.gap)}px` })
      }
    } else if (rows.some(r => r.drawn && r.depth > 0)) results.push({ at, check: 'top-level bullet to compare nested markers with', ok: 'missing', detail: 'no drawn top-level dot on this page' })
  }
}
await browser.close()
// 3. Coverage.
for (const [width, kinds] of seen) for (const kind of REQUIRED) if (!kinds.has(kind)) results.push({ at: `${width}`, check: `${kind}: not on any measured page`, ok: 'missing', detail: 'add it to the copy and run again' })

const label = r => (r.ok === 'missing' ? 'MISSING' : r.ok ? 'ok' : 'FAIL').padEnd(7)
const show = args.includes('--all') ? results : results.filter(r => r.ok !== true)
for (const r of show) console.log(`${label(r)} ${r.at.padEnd(22)} ${r.check} · ${r.detail}`)
const passed = results.filter(r => r.ok === true).length, failed = results.filter(r => r.ok === false).length, missing = results.filter(r => r.ok === 'missing').length
console.log(`\n${passed} passed, ${failed} failed, ${missing} missing${args.includes('--all') ? '' : ' (passing checks not listed; --all lists them)'}`)
if (failed || missing) process.exitCode = 1
