// Geometry check for day-page rows: the standing rule for every visual change (Lead 4b3ce971, Ratchet 74c68e9d,
// checklist "How to update"). Read-only: it opens pages, hovers rows and measures; it never types or saves.
//
//   node scripts/check-alignment.mjs <base url> [path ...] [--all]
//   e.g. node scripts/check-alignment.mjs http://127.0.0.1:3361 /day/2026-10-18 /day/2026-10-19
//
// Run it against a build serving a copy of Brian's data. Paths default to Oct 18, Oct 19 and today. At 1280 and 390:
//   1. Columns. Each row against its own expected column:
//      - top-level rows (open/done/cancelled tasks, bullets, numbered lines, page and link cards, empty rows): one
//        shared text column, the one most rows use;
//      - a nested row: its parent's text column + 24px (B19: one step right of the parent's text);
//      - headings: the editor's own left edge.
//   2. Markers on the first text line: a task's checkbox, a top-level bullet's dot, a card's icon and chevron, and
//      (1280, hovered) the drag handle, each centred on the row's first text line.
//   3. Coverage. Every row type in REQUIRED must appear on the measured pages; one that doesn't is MISSING, never a
//      pass. Add it to the data copy (or pass a fixture page) and run again.
// Tolerance is 1px on unrounded coordinates (output shows one decimal). Exit code 1 on any FAIL or MISSING.
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const [base, ...given] = args.filter(a => !a.startsWith('--'))
if (!base) { console.error('usage: node scripts/check-alignment.mjs <base url> [path ...] [--all]'); process.exit(2) }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const paths = given.length ? given : ['/day/2026-10-18', '/day/2026-10-19', `/day/${today}`]
const TOLERANCE = 1, NEST_STEP = 24
const REQUIRED = ['heading', 'open task', 'done task', 'cancelled task', 'bullet', 'nested bullet', 'empty row', 'page card with preview', 'page card without preview', 'link card']

function measure() {
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const cy = r => r.top + r.height / 2
  // The first text line of an element: its first line box, or for an empty row the line its caret would sit on.
  const firstLine = e => {
    const range = document.createRange(); range.selectNodeContents(e)
    const rect = [...range.getClientRects()].find(r => r.width > 0 && r.height > 0)
    const box = e.getBoundingClientRect(), style = getComputedStyle(e)
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2
    return { left: box.left + parseFloat(style.paddingLeft), cy: rect ? cy(rect) : box.top + parseFloat(style.paddingTop) + lineHeight / 2 }
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
      const status = title.classList.contains('task-done') ? 'done' : title.classList.contains('task-cancelled') || content.querySelector('.editor-cancelled-tag') ? 'cancelled' : 'open'
      Object.assign(row, { kind: `${status} task`, empty: !title.textContent.trim(), ...firstLine(title) })
      if (box && visible(box)) row.markers.checkbox = cy(box.getBoundingClientRect())
    } else if (type === 'pageLink') {
      const card = content.querySelector('.editor-page-card'), title = content.querySelector('.editor-page-card-title')
      if (!card || !title) return
      const link = Boolean(content.querySelector('.editor-page-card-row.is-link'))
      Object.assign(row, { kind: link ? 'link card' : content.querySelector('.editor-page-card-preview') ? 'page card with preview' : 'page card without preview', ...firstLine(title) })
      const icon = card.querySelector('.editor-page-card-icon'), chevron = card.querySelector(':scope > svg')
      if (icon && visible(icon)) row.markers.icon = cy(icon.getBoundingClientRect())
      if (chevron && visible(chevron)) row.markers.chevron = cy(chevron.getBoundingClientRect())
    } else if (type === 'bulletListItem' || type === 'numberedListItem' || type === 'paragraph') {
      const inline = content.querySelector('.bn-inline-content')
      const list = type === 'bulletListItem' ? 'bullet' : 'numbered'
      Object.assign(row, { kind: type === 'paragraph' ? 'paragraph' : d > 0 ? `nested ${list}` : list, empty: !text, ...firstLine(inline) })
      // Top-level bullets draw their dot as a ::before box, the dot centred in its height (styles.css).
      const before = getComputedStyle(content, '::before')
      if (type === 'bulletListItem' && d === 0 && before.content !== 'none' && parseFloat(before.height))
        row.markers.dot = content.getBoundingClientRect().top + parseFloat(getComputedStyle(content).paddingTop) + parseFloat(before.height) / 2
    } else if (type === 'heading') {
      Object.assign(row, { kind: 'heading', ...firstLine(content.querySelector('.bn-inline-content')) })
    } else return
    rows.push(row)
  })
  return { rows, editorLeft }
}

const fmt = n => (Math.round(n * 10) / 10).toFixed(1)
const browser = await chromium.launch()
const results = [], seen = new Map()
for (const [width, height] of [[1280, 900], [390, 844]]) {
  seen.set(width, new Set())
  for (const path of paths) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000)
    const { rows, editorLeft } = await page.evaluate(measure)
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
          const text = content?.querySelector('.editor-task-title, .editor-page-card-title, .bn-inline-content')
          const range = document.createRange(); if (text) range.selectNodeContents(text)
          const line = text && [...range.getClientRects()].find(r => r.width > 0 && r.height > 0)
          const h = document.querySelector('.editor-handle svg'), r = h?.getBoundingClientRect()
          return r?.width ? { handle: r.top + r.height / 2, cy: line ? line.top + line.height / 2 : null } : null
        }, row.index)
        // Hovering scrolls the page, so the handle is compared with the row measured at the same moment.
        if (after?.cy != null) row.hovered = after
      }
    }
    await page.close()
    const at = `${width} ${path}`
    for (const r of rows) { seen.get(width).add(r.kind); if (r.empty) seen.get(width).add('empty row') }
    // 1. Columns.
    const top = rows.filter(r => r.depth === 0 && r.kind !== 'heading' && r.kind !== 'paragraph')
    const counts = new Map(); for (const r of top) { const x = Math.round(r.left); counts.set(x, (counts.get(x) ?? 0) + 1) }
    const usual = counts.size ? [...counts].sort((a, b) => b[1] - a[1])[0][0] : null
    const column = usual === null ? null : top.find(r => Math.round(r.left) === usual).left
    for (const r of rows) {
      let expected = null, rule = ''
      if (r.kind === 'heading') { expected = editorLeft; rule = 'editor edge' }
      else if (r.kind === 'paragraph') continue
      else if (r.depth > 0) { const parent = rows.find(p => p.index === r.parent); if (!parent) continue; expected = parent.left + NEST_STEP; rule = `parent ${fmt(parent.left)} + ${NEST_STEP}` }
      else { expected = column; rule = 'row column' }
      if (expected === null) continue
      const off = r.left - expected
      results.push({ at, check: `${r.kind} text x: "${r.label}"`, ok: Math.abs(off) <= TOLERANCE, detail: `x=${fmt(r.left)}, expected ${fmt(expected)} (${rule}), off ${off >= 0 ? '+' : ''}${fmt(off)}` })
    }
    // 2. Markers on the first text line.
    for (const r of rows) {
      const markers = Object.entries(r.markers).map(([m, y]) => [m, y - r.cy])
      if (r.hovered) markers.push(['handle', r.hovered.handle - r.hovered.cy])
      for (const [marker, off] of markers)
        results.push({ at, check: `${r.kind} ${marker} on first line: "${r.label}"`, ok: Math.abs(off) <= TOLERANCE, detail: `${off >= 0 ? '+' : ''}${fmt(off)}px` })
    }
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
