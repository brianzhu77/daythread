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
//   Tables (Lead 319a428b): in every cell type of a table's rows and of a row page's properties, what's drawn (text, chip,
//   checkbox) is centred on its row within 1px; on a row page, the name's text too, and the value against the name.
//   Inline chips (A9a page links, A11 line links): the chip's height within its line's box, and its text on the same
//   baseline as the plain text beside it (Jazz line-links-states §7 check 10).
//   Icons (P1-3, icons-covers.md section 7): in a page's, a row's and a day's head, the icon's box 2px back of the title's words, its size and its line, and an
//   icon of ours (whose ink fills its box, unlike an emoji's) drawn at the words' edge. Before a name wherever one shows, centred on the name's first line (a
//   [[ link: on where a chip's own icon sits), and the name, or in a database the icon, starting where one with no icon does. Each place in that section's table is
//   required: sidebar, Pages, Trash, subpage rows, page cards, [[ links, a relation's chip, search, Linked from, the breadcrumb, Move to, a database's title, and a row in each layout.
//   Smart notes (smart-note.md §4), on /pages?page=fixture-smart-page: the block's left edge on the editor's, each part
//   inside the block, the body in the page's text size and line height; at 1280 the header's words and controls centred on
//   the name's first line; at 390 each header control a 44px target and the page no wider than the screen. Each stored
//   state is required: plain, Notes changed, its range deleted, and a deleted note. Setup and the picker aren't measured
//   here (no sheet is); the smoke checks their 44px targets.
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
// Where an icon sits before a name, and what's measured for each: `row` centres on the whole row, as its name can have a second line under it.
const ICON_PLACES = [['.tree-row', 'icon: sidebar', 'name'], ['.card-row', 'icon: Pages', 'row'], ['.subpage-row', 'icon: subpage row', 'name'], ['.editor-page-card', 'icon: page card', 'name'], ['.page-ref', 'icon: [[ link', 'chip'], ['.database-title-cell', 'icon: table row', 'start'], ['.database-list-title', 'icon: list row', 'start'], ['.database-card-title', 'icon: board card', 'centre'], ['.database-gallery-title', 'icon: gallery card', 'centre'], ['.database-day-title', 'icon: calendar', 'centre'], ['.database-bar, .database-week-open', 'icon: timeline', 'centre'], ['.database-pane-name', 'icon: timeline table', 'centre'], ['.database-title-row', 'icon: database title', 'input'], ['.crumb', 'icon: breadcrumb', 'centre'], ['.linked-from a', 'icon: Linked from', 'name'], ['.move-row', 'icon: Move to', 'row'], ['.row-property-value, .database-relation-chip', 'icon: relation chip', 'centre']]
const ICON_HEADS = [{ kind: 'icon: page head', path: '/pages?page=fixture-icon-page', title: '.page-title-field' }, { kind: 'icon: own icon in a head', path: '/pages?page=fixture-own-icon-page', title: '.page-title-field', ink: true }, { kind: 'icon: row page head', path: '/pages?page=fixture-icon-row', title: '.page-title-field' }, { kind: 'icon: day head', path: '/day/2026-12-30', title: '.day-title' }]
const REQUIRED = ['smart note', 'smart note: Notes changed', 'smart note: range deleted', 'smart note: deleted', 'timeline', 'sub-items', 'peek', 'side peek', 'synced block', 'sub-groups', 'lanes', 'board', 'grouped table', 'list', 'gallery', 'calendar', 'heading', 'open task', 'done task', 'cancelled task', 'bullet', 'nested bullet', 'level 3 bullet', 'nested task', 'level 3 task', 'empty row', 'page card with preview', 'page card without preview', 'link card', 'line link', 'table head', ...['title', 'text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url'].map(t => `table cell: ${t}`), ...['text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url'].map(t => `row page: ${t}`), 'database table', 'picker dot on a plain day', 'picker dot on today', 'picker dot on the selected day', ...ICON_PLACES.map(([, kind]) => kind), ...ICON_HEADS.map(h => h.kind), 'icon: search', 'icon: Trash']

/** Each icon before a name on this page, against its name, and against a place like it with no icon. */
function iconPlaces(places) {
  const cy = r => r.top + r.height / 2
  const wordsOf = (host, after) => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || after?.contains(n) || (after && !(after.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING))) continue
      const range = document.createRange(); range.selectNodeContents(n)
      return range.getClientRects()[0] ?? null
    }
    return null
  }
  const out = []
  for (const [selector, kind, how] of places) for (const host of document.querySelectorAll(selector)) {
    const icon = host.querySelector('.page-emoji, .database-row-icon, .database-title-icon')
    if (!icon || !icon.getClientRects().length) continue
    const input = how === 'input' ? host.querySelector('input') : null
    const words = input ? (() => { const r = input.getBoundingClientRect(); return { top: r.top, height: r.height, left: r.left + parseFloat(getComputedStyle(input).paddingLeft) } })() : wordsOf(host, icon)
    const box = icon.getBoundingClientRect(), row = { kind, how, label: input ? input.value.slice(0, 24) : words ? host.textContent.replace(icon.textContent, '').trim().slice(0, 24) : '(no name)', size: box.width }
    if (!words) { out.push({ ...row, off: null }); continue }
    row.gap = words.left - box.right
    const plain = [...(host.parentElement?.parentElement?.querySelectorAll(selector) ?? [])].find(h => !h.querySelector('.page-emoji, .database-row-icon, .database-title-icon') && h.getClientRects().length)
    if (how === 'chip') {
      const plainChip = [...document.querySelectorAll('.page-ref:not(.line-ref)')].find(h => !h.querySelector('.page-emoji')), own = plainChip?.querySelector('.page-ref-icon svg'), ownWords = plainChip && wordsOf(plainChip, own)
      // A page with no plain chip to compare with isn't where this is measured: the fixture day is.
      if (!own || !ownWords) continue
      row.off = (cy(box) - cy(words)) - (cy(own.getBoundingClientRect()) - cy(ownWords))
    } else row.off = cy(box) - (how === 'row' ? cy(host.getBoundingClientRect()) : cy(words))
    // Same list: the name starts where it would with no icon; in a database's rows, the icon does, as nothing's held for one.
    const plainWords = plain && wordsOf(plain)
    if (plainWords && (how === 'name' || how === 'row')) row.startsOff = words.left - plainWords.left
    if (plainWords && how === 'start') row.startsOff = box.left - plainWords.left
    out.push(row)
  }
  return out
}

/** The icon in a head: its box against the title's words, and whether it's a glyph or ours. */
function iconHead(title) {
  const icon = document.querySelector('.page-icon'), t = document.querySelector(title)
  if (!icon || !t) return null
  let words = t.value !== undefined ? t.getBoundingClientRect().left + parseFloat(getComputedStyle(t).paddingLeft) + parseFloat(getComputedStyle(t).borderLeftWidth) : null
  if (words === null) { const n = document.createTreeWalker(t, NodeFilter.SHOW_TEXT).nextNode(), range = document.createRange(); range.selectNodeContents(n); words = range.getBoundingClientRect().left }
  const box = icon.getBoundingClientRect(), line = icon.parentElement.getBoundingClientRect(), glyph = icon.firstElementChild
  return { words, left: box.left, top: box.top, width: 70, lineHeight: line.height, font: parseFloat(getComputedStyle(glyph).fontSize), glyphWidth: glyph.getBoundingClientRect().width, gap: t.getBoundingClientRect().top - box.bottom }
}

/** What's really drawn in a box, as the bullets' pass reads it: the leftmost pixel that differs from the box's corner. */
async function inkLeft(page, x, y, width, height) {
  const png = await page.screenshot({ clip: { x, y, width, height } })
  return page.evaluate(async ([data, from]) => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height
    const k = canvas.getContext('2d'); k.drawImage(img, 0, 0)
    const px = k.getImageData(0, 0, img.width, img.height).data
    for (let col = 0; col < img.width; col++) for (let row = 0; row < img.height; row++) {
      const o = (row * img.width + col) * 4
      if (Math.abs(px[o] - px[0]) + Math.abs(px[o + 1] - px[1]) + Math.abs(px[o + 2] - px[2]) > 60) return from + col
    }
    return null
  }, [png.toString('base64'), x])
}

/** What a table cell or a row page's value draws: its box when it's a checkbox, else its first line of text, else a chip or dot. */
function drawnCentres() {
  const cy = r => r.top + r.height / 2
  const drawn = host => {
    const box = host.querySelector('.property-checkbox')
    if (box) return cy(box.getBoundingClientRect())
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || n.parentElement.closest('.database-open, .database-row-gutter, .is-placeholder')) continue
      const range = document.createRange(); range.selectNodeContents(n)
      const line = [...range.getClientRects()].find(r => r.width > 0 && r.height > 0)
      if (line) return cy(line)
    }
    return null
  }
  const cells = [...document.querySelectorAll('.database-row')].flatMap(row => [...row.querySelectorAll(':scope > td')].map(td => {
    const type = td.classList.contains('is-title') ? 'title' : [...td.classList].find(c => c.startsWith('is-') && !['is-saving', 'is-unsaved'].includes(c))?.slice(3)
    const y = drawn(td)
    return y === null ? null : { where: 'table cell', type, label: row.querySelector('.database-title-cell')?.textContent.trim().slice(0, 16) ?? '', off: y - cy(row.getBoundingClientRect()) }
  })).filter(Boolean)
  // The head's names, on their row the same way.
  for (const th of document.querySelectorAll('.database-table thead th')) {
    const y = drawn(th), row = th.closest('tr')
    if (y !== null) cells.push({ where: 'table head', type: 'head', label: th.textContent.trim().slice(0, 16), off: y - cy(row.getBoundingClientRect()) })
  }
  const properties = [...document.querySelectorAll('.row-property')].flatMap(row => {
    const name = row.querySelector('.row-property-name'), type = name?.getAttribute('data-type'), value = row.querySelector('.row-property-value')
    if (!name || !value) return []
    const nameY = drawn(name), y = drawn(value), own = cy(row.getBoundingClientRect())
    return y === null || nameY === null ? [] : [{ where: 'row page', type, label: name.textContent.trim().slice(0, 16), off: y - own, name: nameY - own, against: y - nameY }]
  })
  const firstRow = document.querySelector('.database-row [data-cell]')?.getAttribute('data-cell')
  return { cells, properties, firstRow }
}

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
  // A synced block's own group is no level: its lines keep the columns they have outside (states §3).
  const isSynced = block => block?.querySelector(':scope > .react-renderer > .bn-block-content[data-content-type="syncedBlock"]')
  const depth = e => { let d = 0; for (let g = e.closest('.bn-block-group'); g; g = g.parentElement?.closest('.bn-block-group')) if (!isSynced(g.parentElement)) d++; return d - 1 }
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
    const holder = outer.parentElement?.closest('.bn-block-outer')
    const row = { index, depth: d, label: (text || '(empty)').slice(0, 24), parent: holder && isSynced(holder.querySelector(':scope > .bn-block')) ? -1 : outers.indexOf(holder), markers: {} }
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
    } else if (type === 'smartNote') {
      // A smart note (smart-note.md §4): on the editor's edge, as a database block is; at 1280 the header's words and
      // controls on the name's line; its parts inside it, and its body in the page's text size.
      const note = content.querySelector('.smart-note'), name = note?.querySelector('.smart-note-name')
      if (!note || !name || !visible(note)) return
      const status = note.querySelector('.smart-note-status')?.textContent ?? ''
      const state = note.classList.contains('is-deleted') ? ': deleted' : note.querySelector('.smart-note-changed') ? ': Notes changed' : status.includes('range was deleted') ? ': range deleted' : status ? `: ${status}` : ''
      Object.assign(row, { kind: `smart note${state}`, ...firstLine(name.querySelector(':scope > span') ?? name), left: note.getBoundingClientRect().left })
      if (innerWidth >= 900) for (const part of note.querySelectorAll('.smart-note-meta > *, .smart-note-actions button')) {
        const what = part.matches('.smart-note-changed') ? 'Notes changed' : part.matches('.smart-note-updated') ? 'Updated' : part.matches('.smart-note-status') ? 'status' : part.getAttribute('aria-label') === 'Refresh' ? 'Refresh' : 'menu'
        row.markers[what] = visible(part) ? cy(part.getBoundingClientRect()) : null
      }
      const box = note.getBoundingClientRect()
      row.spill = Math.max(0, ...[...note.querySelectorAll('*')].filter(visible).map(e => { const r = e.getBoundingClientRect(); return Math.max(r.right - box.right, box.left - r.left) }))
      const body = note.querySelector('.smart-note-body'), text = document.querySelector('.continuous-editor [data-content-type="paragraph"] .bn-inline-content, .continuous-editor [data-content-type="bulletListItem"] .bn-inline-content')
      if (body) row.bodyText = text ? { body: `${getComputedStyle(body).fontSize}/${getComputedStyle(body).lineHeight}`, page: `${getComputedStyle(text).fontSize}/${getComputedStyle(text).lineHeight}` } : null
    } else if (type === 'database') {
      // Databases (design §15): the title on the row column (as any top-level row), the view's chevron centred on its
      // word, and `+ New` on Name's text. Only a home block draws a table; any other is a page card, not measured here.
      const title = content.querySelector('.database-title')
      if (!title) return
      Object.assign(row, { kind: 'database table', label: (title.value || '(untitled)').slice(0, 24), ...firstLine(title) })
      // With an icon before it, the title's row starts at the icon, and that's what lines up.
      const ownIcon = content.querySelector('.database-title-icon')
      if (ownIcon) row.left = ownIcon.getBoundingClientRect().left
      const view = content.querySelector('.database-view-name'), chevron = view?.querySelector('svg')
      // A linked view shows its view's name with nothing to open, so no chevron to measure.
      if (view?.classList.contains('is-static')) row.viewChevron = 'none'
      else if (view && chevron && visible(chevron)) {
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
      // A board and a grouped table (R2): a marker that's found nothing is MISSING. The fixture has a capped column and group,
      // a hidden group, and a card with a value and a checkbox, so all of these are there to measure.
      const words = el => { if (!el) return null; const t = document.createRange(); t.selectNodeContents(el); return [...t.getClientRects()].find(x => x.width > 0) ?? null }
      const gap = (a, b) => (a && b ? a.left - b.left : null), mid = (a, b) => (a && b ? cy(a) - cy(b) : null)
      const hidden = words(content.querySelector('.database-hidden-groups'))
      // Sub-groups (R3-13): a second layer one step in from its group; on a board, lanes on the title's edge under one row of heads.
      const firstSub = content.querySelector('.database-group-inner.is-sub .database-group-fold')
      if (firstSub) {
        const group = content.querySelector('.database-group-inner:not(.is-sub) .database-group-fold')
        row.subGroups = { "sub-group's chevron one step in from its group's": group ? firstSub.getBoundingClientRect().left - group.getBoundingClientRect().left - 16 : null }
      }
      const lane = content.querySelector('.database-lane')
      if (lane) {
        const head = content.querySelector('.database-lane-head-cell .database-column-head'), card = lane.querySelector('.database-card')
        row.lanes = {
          "lane's chevron on the title": lane.querySelector('.database-group-fold').getBoundingClientRect().left - (title.parentElement.querySelector('.database-title-icon') ?? title).getBoundingClientRect().left,
          'column head on the title': head ? head.getBoundingClientRect().left - (title.parentElement.querySelector('.database-title-icon') ?? title).getBoundingClientRect().left : null,
          "card's edge on its column head": head && card ? card.getBoundingClientRect().left - head.getBoundingClientRect().left : null,
        }
      }
      // Sub-items (R4-4): a top row's words on the head's Name, and a sub-item one step in. Open the first parent to measure it.
      const toggle = content.querySelector('.database-sub-toggle')
      if (toggle) {
        const rowWords = el => words(el?.querySelector('.database-title-cell > span:last-child, .database-title-text') ?? el?.querySelector('.database-title-cell'))
        const name = content.querySelector('.database-th[data-type="title"]'), rows = [...content.querySelectorAll('.database-row')]
        const nameWords = name ? (() => { const text = document.createRange(); text.selectNode(name.lastChild); return text.getBoundingClientRect() })() : null
        row.subItems = { "a top row's words on the head's Name": rows[0] ? gap(rowWords(rows[0]), nameWords) : null, 'toggle centred on its row': mid(toggle.getBoundingClientRect(), words(rows[0]?.querySelector('.database-title-cell'))) }
        row.layered = true
      }
      // A timeline (R4-1): a bar's title centred on it, and a day's number and grid line together.
      const bar = content.querySelector('.database-timeline .database-bar')
      if (bar) {
        const tick = content.querySelector('.database-scale-tick'), lines = [...content.querySelectorAll('.database-grid-line')]
        const words2 = words(bar.querySelector('.database-bar-title'))
        const line = tick && lines.find(l => Math.abs(l.getBoundingClientRect().left - tick.getBoundingClientRect().left) < 2)
        row.timeline = { "bar's title centred on its bar": mid(words2, bar.getBoundingClientRect()), 'scale tick on its grid line': line ? line.getBoundingClientRect().left - tick.getBoundingClientRect().left : null }
        row.layered = true
      }
      // At 390 it's a list by week: its words on + New's.
      const weekRow = content.querySelector('.database-week-title')
      if (weekRow) {
        row.timeline = { "a week row's words on + New's": gap(words(weekRow), words(content.querySelector('.database-new'))) }
        row.layered = true
      }
      // These fixtures are small, with no cap or hidden group: only the rules above apply to them.
      if (firstSub || lane) row.layered = true
      const column = lane ? null : content.querySelector('.database-board .database-column')
      if (column) {
        const head = column.querySelector('.database-column-head'), card = column.querySelector('.database-card'), name = words(card?.querySelector('.database-card-title'))
        const capped = content.querySelector('.database-column:has(.database-more)')
        const cappedName = words(capped?.querySelector('.database-card-title'))
        const box = card?.querySelector('.property-checkbox')?.getBoundingClientRect()
        row.board = {
          'column head on the title': head ? head.getBoundingClientRect().left - (title.parentElement.querySelector('.database-title-icon') ?? title).getBoundingClientRect().left : null,
          "card's edge on its column head": head && card ? card.getBoundingClientRect().left - head.getBoundingClientRect().left : null,
          // The name's words, not a status's dot before them, which is drawn smaller.
          "count centred on its column's name": mid(words(head?.querySelector('.database-group-count')), words(head?.firstElementChild?.lastChild)),
          "+ New on a card's words": gap(words(column.querySelector(':scope > .database-new')), name),
          "Show 25 more on a card's words": gap(words(capped?.querySelector('.database-more')), cappedName),
          "a value on a card's words": gap(words(card?.querySelector('.database-card-value')), name),
          "a checkbox on a card's words": box && name ? box.left - name.left : null,
          'a checkbox centred on its name': mid(box, words(card?.querySelector('.database-card-check')?.lastChild)),
          "Hidden on a card's words": gap(hidden, name),
        }
      }
      const calendar = content.querySelector('.database-calendar')
      if (calendar) {
        const head = content.querySelector('.database-calendar-head'), month = words(head?.querySelector('.database-calendar-month'))
        const first = calendar.querySelector('.database-day'), number = first?.querySelector('.database-day-number')
        const weekday = calendar.querySelector('.database-calendar-weekday')
        const withRow = [...calendar.querySelectorAll('.database-day')].find(d => d.querySelector('.database-day-title')), chip = withRow?.querySelector('.database-day-title')
        const days = [...calendar.querySelectorAll('.database-day')].map(d => d.getBoundingClientRect().width)
        row.calendar = {
          'month on the title': month ? month.left - title.getBoundingClientRect().left : null,
          'the grid on the title': calendar.getBoundingClientRect().left - (title.parentElement.querySelector('.database-title-icon') ?? title).getBoundingClientRect().left,
          "the grid's right on the page's": calendar.getBoundingClientRect().right - content.getBoundingClientRect().right,
          'every day the same width': days.length ? Math.max(...days) - Math.min(...days) : null,
          'first weekday on its day': weekday && first ? weekday.getBoundingClientRect().left - first.getBoundingClientRect().left : null,
          "a day's number centred on its box": number ? mid(words(number), number.getBoundingClientRect()) : null,
          ...(innerWidth >= 900 ? { 'a title on its day': chip && withRow ? chip.getBoundingClientRect().left - withRow.getBoundingClientRect().left - 3 : null } : {}),
        }
      }
      const gallery = content.querySelector('.database-gallery')
      if (gallery) {
        const card = gallery.querySelector('.database-gallery-card'), name = words(card?.querySelector('.database-gallery-title'))
        const box = card?.querySelector('.property-checkbox')?.getBoundingClientRect()
        row.gallery = {
          "card's edge on the title": card ? card.getBoundingClientRect().left - (title.parentElement.querySelector('.database-title-icon') ?? title).getBoundingClientRect().left : null,
          "+ New on a card's words": gap(words(content.querySelector('.database-new.is-under-cards')), name),
          "Show 25 more on a card's words": gap(words(content.querySelector('.database-gallery + .database-more, .database-more.is-under-cards')), name),
          "a value on a card's words": gap(words(card?.querySelector('.database-card-value')), name),
          "a checkbox on a card's words": box && name ? box.left - name.left : null,
          'a checkbox centred on its name': mid(box, words(card?.querySelector('.database-card-check')?.lastChild)),
          "group's chevron on the title": content.querySelector('.database-group-fold') ? content.querySelector('.database-group-fold').getBoundingClientRect().left - (title.parentElement.querySelector('.database-title-icon') ?? title).getBoundingClientRect().left : null,
          "Hidden on a card's words": gap(words(content.querySelector('.database-hidden-groups')), name),
        }
      }
      const list = content.querySelector('.database-list')
      if (list) {
        const name = words(list.querySelector('.database-list-title'))
        const box = list.querySelector('.database-list-check .property-checkbox')?.getBoundingClientRect()
        const value = list.querySelector('.database-list-value')
        const narrow = innerWidth < 900
        row.list = {
          "+ New on a row's words": gap(words(list.querySelector('.database-list-foot .database-new')), name),
          "Show 25 more on a row's words": gap(words(list.querySelector('.database-list-foot .database-more')), name),
          "Hidden on a row's words": gap(hidden, name),
          // On a line at 1280 they're centred on the title; under it on the phone they start on its edge.
          [narrow ? "a value on a row's words" : 'a value centred on its title']: narrow ? gap(words(value), name) : mid(words(value), name),
          // Beside a value on the phone's second line, so what it's measured against is its own name there.
          [narrow ? 'a checkbox centred on its name' : 'a checkbox centred on its title']: !box || !name ? null : narrow ? mid(box, words(list.querySelector('.database-list-check')?.lastChild)) : cy(box) - cy(name),
          "group's chevron on the title": list.querySelector('.database-group-fold') ? list.querySelector('.database-group-fold').getBoundingClientRect().left - (title.parentElement.querySelector('.database-title-icon') ?? title).getBoundingClientRect().left : null,
        }
      }
      const fold = list || gallery ? null : content.querySelector('.database-group-fold')
      if (fold) {
        const label = fold.querySelector('svg + *'), nameText = words(content.querySelector('.database-title-cell > span'))
        row.group = {
          "fold's chevron on the title": fold.getBoundingClientRect().left - (title.parentElement.querySelector('.database-title-icon') ?? title).getBoundingClientRect().left,
          'chevron centred on its name': mid(fold.querySelector('svg')?.getBoundingClientRect(), words(label)),
          "count centred on its group's name": mid(words(fold.querySelector('.database-group-count')), words(label)),
          "Show 25 more on Name's text": gap(words(content.querySelector('.database-group-foot .database-more')), nameText),
          "Hidden on Name's text": gap(hidden, nameText),
        }
      }
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
  // Synced blocks (states §3): room above and below, whether or not the label shows; the label, laid out while hidden, clears the
  // first line's text and the line above; the outline stays on the screen. Their lines are measured as rows, above.
  const textTop = e => { const c = e.querySelector('.bn-inline-content, .editor-task-title'); const range = document.createRange(); range.selectNodeContents(c); return [...range.getClientRects()].find(r => r.width > 0)?.top ?? c.getBoundingClientRect().top }
  const textBottom = e => { const all = [...e.querySelectorAll('.bn-inline-content, .editor-task-title')], c = all.at(-1); if (!c) return e.getBoundingClientRect().bottom; const range = document.createRange(); range.selectNodeContents(c); return [...range.getClientRects()].filter(r => r.width > 0).at(-1)?.bottom ?? c.getBoundingClientRect().bottom }
  const synced = [...document.querySelectorAll('.continuous-editor .bn-block-content[data-content-type="syncedBlock"]')].flatMap(content => {
    const block = content.closest('.bn-block'), outer = block.closest('.bn-block-outer'), lines = block.querySelector(':scope > .bn-block-group'), label = content.querySelector('.synced-label')
    const above = outer.previousElementSibling, below = outer.nextElementSibling
    if (!lines || !label) return []
    const box = lines.getBoundingClientRect(), tag = label.getBoundingClientRect(), offset = parseFloat(getComputedStyle(block).outlineOffset) + 1
    return [{
      label: lines.textContent.trim().slice(0, 24),
      room: { 'room above its first line (8px)': above ? box.top - above.getBoundingClientRect().bottom - 8 : null, 'room below its last line (6px)': below ? below.getBoundingClientRect().top - box.bottom - 6 : null },
      clear: { "label's gap to the first line's text": textTop(lines) - tag.bottom, "label's gap to the line above": above ? tag.top - textBottom(above) : null, "outline's left to the screen": box.left - offset, "outline's right to the screen": document.documentElement.clientWidth - box.right - offset },
      outlineLeft: box.left - offset, editorLeft,
    }]
  })
  return { rows, editorLeft, chips, synced }
}

const fmt = n => (Math.round(n * 10) / 10).toFixed(1)
const signed = n => `${n >= 0 ? '+' : ''}${fmt(n)}px`
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
  // The account line's selects draw their words at full width: a select holding its own text clipped them (Lead b6ca77b3).
  {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto(`${base}/pages`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
    const selects = await page.evaluate(() => [...document.querySelectorAll('.account-row select')].filter(select => select.getClientRects().length).map(select => {
      const clip = select.closest('.account-row').querySelector(':scope > p').getBoundingClientRect(), words = select.closest('.account-select')?.querySelector('.account-select-text'), box = words?.getBoundingClientRect()
      const range = document.createRange(); if (words) range.selectNodeContents(words)
      return { label: select.getAttribute('aria-label'), text: words?.textContent ?? '', over: !box ? null : Math.max(range.getBoundingClientRect().right - box.right, box.right - clip.right), full: Boolean(box) && select.getBoundingClientRect().width >= box.width - 0.5 }
    }))
    // From 900 px the account's choices are in the sidebar footer's menu (bb12a273): each value shows whole, inside the menu.
    if (!selects.length && await page.locator('.side-account-row').isVisible().catch(() => false)) {
      await page.locator('.side-account-row').click(); await page.waitForTimeout(300)
      const picks = await page.evaluate(() => [...document.querySelectorAll('.side-account-menu .menu-pick')].map(pick => {
        const value = pick.querySelector('.menu-pick-value'), menu = pick.closest('.side-account-menu').getBoundingClientRect(), range = document.createRange()
        if (value) range.selectNodeContents(value)
        const words = value ? range.getBoundingClientRect() : null, box = value?.getBoundingClientRect()
        return { label: pick.querySelector('select')?.getAttribute('aria-label') ?? '', text: value?.textContent ?? '', over: words ? Math.max(words.right - box.right, box.right - menu.right) : null }
      }))
      for (const r of picks) results.push({ at: `${width} /pages`, check: `account menu "${r.label}" shows all its words: "${r.text}"`, ok: r.over !== null && r.over <= 0.5, detail: r.over === null ? 'no value shown' : `${fmt(r.over)}px past its box` })
      if (!picks.length) results.push({ at: `${width}`, check: 'account menu choices: none on /pages', ok: 'missing', detail: 'nothing to measure' })
    } else if (!selects.length) results.push({ at: `${width}`, check: 'account line selects: not on /pages', ok: 'missing', detail: 'nothing to measure' })
    for (const r of selects) results.push({ at: `${width} /pages`, check: `account line "${r.label}" shows all its words: "${r.text}"`, ok: r.over !== null && r.over <= 0.5 && r.full, detail: r.over === null ? 'a bare select, which clips' : `${fmt(r.over)}px past its box` })
    await page.close()
  }
  // Icons (P1-3): each head, and each place a name shows.
  for (const head of ICON_HEADS) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto(`${base}${head.path}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
    const r = await page.evaluate(iconHead, head.title), at = `${width} ${head.path}`
    if (!r) { results.push({ at, check: `${head.kind}: icon and title`, ok: 'missing', detail: 'not found, so not measured' }); await page.close(); continue }
    seen.get(width).add(head.kind)
    const [font, line] = width === 1280 ? [44, 52] : [36, 44], gapMax = width === 1280 ? 14 : 14
    results.push({ at, check: `${head.kind}: 2px back of the title's words`, ok: Math.abs(r.words - r.left - 2) <= TOLERANCE, detail: `${fmt(r.words - r.left)}px back` })
    results.push({ at, check: `${head.kind}: ${font}px, on a ${line}px line`, ok: r.font === font && r.lineHeight === line && r.glyphWidth <= font + TOLERANCE, detail: `${fmt(r.font)}px, ${fmt(r.glyphWidth)}px wide, on ${fmt(r.lineHeight)}px` })
    results.push({ at, check: `${head.kind}: just above the title`, ok: r.gap >= 0 && r.gap <= gapMax, detail: `${fmt(r.gap)}px` })
    if (head.ink) {
      const ink = await inkLeft(page, Math.max(0, r.left - 6), r.top, r.width, r.lineHeight)
      results.push({ at, check: `${head.kind}: drawn at the title's edge`, ok: ink !== null && Math.abs(ink - r.words) <= TOLERANCE, detail: ink === null ? 'nothing drawn' : `${fmt(ink - r.words)}px` })
    }
    await page.close()
  }
  for (const [path, label] of [['/pages', 'Pages'], ['/pages?view=trash', 'Trash'], ['/pages?page=fixture-icon-page', 'a page'], ['/pages?page=fixture-icon-child', 'a page under one'], ['/pages?page=fixture-own-icon-page', 'a page linked from one'], ['/pages?page=fixture-icon-row', "a row's page"], ['/pages?page=fixture-icon-timeline', "a Timeline's table"], ['/day/2026-12-31', 'the fixture day']]) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000)
    // Layouts draw what's near the screen, so go down it once first.
    await page.evaluate(async () => { const s = document.scrollingElement; for (let y = 0; y < s.scrollHeight; y += 500) { s.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)) } s.scrollTo(0, 0) }); await page.waitForTimeout(300)
    const at = `${width} ${path}`
    for (const r of await page.evaluate(iconPlaces, ICON_PLACES)) {
      const kind = r.kind === 'icon: Pages' && label === 'Trash' ? 'icon: Trash' : r.kind
      seen.get(width).add(kind)
      const where = r.how === 'chip' ? "centred where a chip's own icon sits" : r.how === 'row' ? 'centred on its row' : "centred on the name's first line"
      results.push(r.off == null ? { at, check: `${kind} ${where}: "${r.label}"`, ok: 'missing', detail: 'nothing to measure it against' } : { at, check: `${kind} ${where}: "${r.label}"`, ok: Math.abs(r.off) <= TOLERANCE, detail: signed(r.off) })
      if (r.gap !== undefined) results.push({ at, check: `${kind} a gap before the name: "${r.label}"`, ok: r.gap >= 2, detail: `${fmt(r.gap)}px` })
      if (r.startsOff !== undefined) results.push({ at, check: `${kind} starts where one with no icon does: "${r.label}"`, ok: Math.abs(r.startsOff) <= TOLERANCE, detail: signed(r.startsOff) })
    }
    await page.close()
  }
  {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto(`${base}/pages?page=fixture-icon-child`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
    await page.getByRole('button', { name: 'Page actions' }).first().click(); await page.waitForTimeout(200); await page.getByRole('menuitem', { name: /^Move to/ }).click(); await page.waitForTimeout(500)
    const at = `${width} Move to`
    for (const r of await page.evaluate(iconPlaces, ICON_PLACES.filter(([, kind]) => kind === 'icon: Move to'))) {
      seen.get(width).add(r.kind)
      results.push(r.off == null ? { at, check: `${r.kind}: "${r.label}"`, ok: 'missing', detail: 'nothing to measure it against' } : { at, check: `${r.kind} centred on the name's first line: "${r.label}"`, ok: Math.abs(r.off) <= TOLERANCE, detail: signed(r.off) })
      if (r.gap !== undefined) results.push({ at, check: `${r.kind} a gap before the name: "${r.label}"`, ok: r.gap >= 2, detail: `${fmt(r.gap)}px` })
      if (r.startsOff !== undefined) results.push({ at, check: `${r.kind} starts where one with no icon does: "${r.label}"`, ok: Math.abs(r.startsOff) <= TOLERANCE, detail: signed(r.startsOff) })
    }
    await page.close()
  }
  {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto(`${base}/pages`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
    if (width === 1280) await page.keyboard.press('Control+k'); else await page.getByRole('button', { name: 'Search' }).last().click()
    await page.waitForTimeout(400); await page.keyboard.type('Fixture icon page'); await page.waitForTimeout(800)
    const found = await page.evaluate(() => { const icon = document.querySelector('.search-row-icon .page-emoji'), row = icon?.closest('.search-row, button, a'); if (!icon || !row) return null; const r = icon.getBoundingClientRect(), walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT); let n = walker.nextNode(); while (n && (!n.textContent.trim() || icon.contains(n))) n = walker.nextNode(); if (!n) return null; const range = document.createRange(); range.selectNodeContents(n); const w = range.getClientRects()[0]; return { off: r.top + r.height / 2 - (w.top + w.height / 2), gap: w.left - r.right, label: n.textContent.trim().slice(0, 24) } })
    const at = `${width} search`
    if (found) { seen.get(width).add('icon: search'); results.push({ at, check: `icon: search centred on the name's first line: "${found.label}"`, ok: Math.abs(found.off) <= TOLERANCE, detail: signed(found.off) }); results.push({ at, check: `icon: search a gap before the name: "${found.label}"`, ok: found.gap >= 2, detail: `${fmt(found.gap)}px` }) }
    await page.close()
  }
  // A row over a page (R4-16): at 1280 only, since a phone opens it as a full page.
  // The smart note fixture (align-fixtures.ts) at both widths.
  for (const path of new Set(width === 1280 ? [...paths, '/pages?page=fixture-smart-page', '/pages?page=fixture-peek-db&peek=fixture-peek-row', '/pages?page=fixture-peek-db&peek=fixture-peek-row&side=1'] : [...paths, '/pages?page=fixture-smart-page'])) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000)
    const { rows, editorLeft, chips, synced } = await page.evaluate(measure)
    const inPeek = path.includes('peek=') && rows.length > 0 && await page.locator('.peek .continuous-editor').count() > 0
    await drawPass(page, rows)
    // A smart note on the phone: each control in its header a 44px target, measured as the span of points that hit it
    // (so a clipped or covered control counts as small), and the page no wider than the screen.
    const smartControls = width < 900 ? page.locator('.continuous-editor .smart-note-head button') : null
    const targets = []
    for (let i = 0, n = smartControls ? await smartControls.count() : 0; i < n; i++) {
      const control = smartControls.nth(i)
      await control.evaluate(el => el.scrollIntoView({ block: 'center' }))
      targets.push(await control.evaluate(el => {
        const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
        const hits = (x, y) => { const at = document.elementFromPoint(x, y); return Boolean(at && (at === el || el.contains(at))) }
        if (!hits(cx, cy)) return { label: el.getAttribute('aria-label') ?? el.textContent.trim(), note: el.closest('.smart-note').querySelector('.smart-note-name').textContent.slice(0, 24), width: 0, height: 0 }
        let top = cy, bottom = cy, left = cx, right = cx
        while (hits(cx, top - 1)) top--
        while (hits(cx, bottom + 1)) bottom++
        while (hits(left - 1, cy)) left--
        while (hits(right + 1, cy)) right++
        return { label: el.getAttribute('aria-label') ?? el.textContent.trim(), note: el.closest('.smart-note').querySelector('.smart-note-name').textContent.slice(0, 24), width: right - left + 1, height: bottom - top + 1 }
      }))
    }
    const pageSpill = rows.some(r => r.kind.startsWith('smart note')) ? await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) : null
    await page.evaluate(() => scrollTo(0, 0))
    const table = await page.evaluate(drawnCentres)
    // A row page lists the same values: the table's first row, opened read-only (a cell's key is block|row|column).
    let properties = []
    if (table.firstRow) {
      const rowPage = await browser.newPage({ viewport: { width, height } })
      await rowPage.goto(`${base}/pages?page=${encodeURIComponent(table.firstRow.split('|')[1])}`, { waitUntil: 'networkidle' }); await rowPage.waitForTimeout(1000)
      ;({ properties } = await rowPage.evaluate(drawnCentres))
      await rowPage.close()
    }
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
          const text = content?.querySelector('.editor-task-title, .editor-page-card-title, .bn-inline-content, .database-title') ?? content?.querySelector('.smart-note-name > span') ?? content?.querySelector('.smart-note-name')
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
    if (inPeek) seen.get(width).add(path.includes('side=1') ? 'side peek' : 'peek')
    for (const r of rows) { seen.get(width).add(r.kind); if (r.empty) seen.get(width).add('empty row'); if (r.kind === 'nested bullet' && r.depth >= 2) seen.get(width).add('level 3 bullet'); if (r.kind.endsWith(' task') && r.depth >= 1) seen.get(width).add(r.depth >= 2 ? 'level 3 task' : 'nested task'); if (r.kind.endsWith(' task') && r.depth >= 2) seen.get(width).add('nested task') }
    // 1. Columns.
    const top = rows.filter(r => r.depth === 0 && r.kind !== 'heading' && r.kind !== 'paragraph' && !r.kind.startsWith('smart note'))
    const counts = new Map(); for (const r of top) { const x = Math.round(r.left); counts.set(x, (counts.get(x) ?? 0) + 1) }
    const usual = counts.size ? [...counts].sort((a, b) => b[1] - a[1])[0][0] : null
    const column = usual === null ? null : top.find(r => Math.round(r.left) === usual).left
    for (const r of rows) {
      let expected = null, rule = '', x = r.left, what = 'text'
      // A database's title is styled as a section heading (design §4.1), so it shares the headings' edge.
      if (r.kind === 'heading' || r.kind === 'database table') { expected = editorLeft; rule = 'editor edge' }
      // A smart note's left edge too: it's a block of its own, as a database is, and its words start at its edge.
      else if (r.kind.startsWith('smart note')) { expected = editorLeft; rule = 'editor edge'; what = 'block' }
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
    // A smart note's parts stay inside it; its body has the page's text size and line height.
    for (const r of rows.filter(r => r.kind.startsWith('smart note'))) {
      results.push({ at, check: `${r.kind} nothing past its edges: "${r.label}"`, ok: r.spill <= TOLERANCE, detail: `${fmt(r.spill)}px past` })
      if (r.bodyText !== undefined) results.push(r.bodyText === null
        ? { at, check: `${r.kind} body text: "${r.label}"`, ok: 'missing', detail: 'no page text beside it to compare with' }
        : { at, check: `${r.kind} body text as the page's: "${r.label}"`, ok: r.bodyText.body === r.bodyText.page, detail: `${r.bodyText.body} vs ${r.bodyText.page}` })
    }
    for (const t of targets) results.push({ at, check: `smart note control a 44px target: ${t.label} in "${t.note}"`, ok: t.width >= 44 && t.height >= 44, detail: t.width ? `${t.width}x${t.height}px` : 'covered at its centre' })
    if (pageSpill !== null) results.push({ at, check: 'page with a smart note no wider than the screen', ok: pageSpill <= 0, detail: `${pageSpill}px wider` })
    for (const r of rows) if (r.clipped !== undefined && !r.kind.startsWith('link'))
      results.push({ at, check: `${r.kind} title not clipped: "${r.label}"`, ok: !r.clipped, detail: r.clipped ?? 'wraps' })
    for (const block of synced) {
      seen.get(width).add('synced block')
      for (const [what, off] of Object.entries(block.room)) if (off !== null) results.push({ at, check: `synced block ${what}: "${block.label}"`, ok: Math.abs(off) <= TOLERANCE, detail: `${off >= 0 ? '+' : ''}${fmt(off)}px` })
      for (const [what, gap] of Object.entries(block.clear)) if (gap !== null) results.push({ at, check: `synced block ${what}: "${block.label}"`, ok: gap >= 0, detail: `${fmt(gap)}px` })
    }
    // The database block's own columns (design §15).
    for (const r of rows.filter(r => r.kind === 'database table')) {
      const parts = r.layered ? null : r.board ?? r.list ?? r.gallery ?? r.calendar ?? r.group, name = r.board ? 'board' : r.list ? 'list' : r.gallery ? 'gallery' : r.calendar ? 'calendar' : 'group'
      if (parts) {
        seen.get(width).add(r.board ? 'board' : r.list ? 'list' : r.gallery ? 'gallery' : r.calendar ? 'calendar' : 'grouped table')
        for (const [what, off] of Object.entries(parts)) results.push(off == null
          ? { at, check: `${name} ${what}: "${r.label}"`, ok: 'missing', detail: 'not found, so not measured' }
          : { at, check: `${name} ${what}: "${r.label}"`, ok: Math.abs(off) <= TOLERANCE, detail: `${off >= 0 ? '+' : ''}${fmt(off)}px` })
      }
      for (const [part, kind] of [[r.subGroups, 'sub-groups'], [r.lanes, 'lanes'], [r.subItems, 'sub-items'], [r.timeline, 'timeline']]) {
        if (!part) continue
        seen.get(width).add(kind)
        for (const [what, off] of Object.entries(part)) results.push(off == null
          ? { at, check: `${kind} ${what}: "${r.label}"`, ok: 'missing', detail: 'not found, so not measured' }
          : { at, check: `${kind} ${what}: "${r.label}"`, ok: Math.abs(off) <= TOLERANCE, detail: `${off >= 0 ? '+' : ''}${fmt(off)}px` })
      }
      if (r.viewChevron !== 'none') results.push(r.viewChevron == null
        ? { at, check: `database view chevron: "${r.label}"`, ok: 'missing', detail: 'not found, so not measured' }
        : { at, check: `database view chevron centred on its word: "${r.label}"`, ok: Math.abs(r.viewChevron) <= TOLERANCE, detail: `${r.viewChevron >= 0 ? '+' : ''}${fmt(r.viewChevron)}px` })
      // A board or list has no Name column: its + New is measured against a card's or row's words, above.
      if (!r.board && !r.list && !r.gallery && !r.calendar && !r.layered) results.push(r.newOnName == null
        ? { at, check: `database + New: "${r.label}"`, ok: 'missing', detail: 'no row or no + New, so not measured' }
        : { at, check: `database + New on Name's text: "${r.label}"`, ok: Math.abs(r.newOnName) <= TOLERANCE, detail: `${r.newOnName >= 0 ? '+' : ''}${fmt(r.newOnName)}px` })
    }
    // What's drawn in a table's cells and on a row page, centred on its row (Lead 319a428b).
    const px = n => `${n >= 0 ? '+' : ''}${fmt(n)}px`
    for (const c of table.cells) {
      seen.get(width).add(c.type === 'head' ? 'table head' : `table cell: ${c.type}`)
      results.push({ at, check: `${c.where} ${c.type} centred on its row: "${c.label}"`, ok: Math.abs(c.off) <= TOLERANCE, detail: px(c.off) })
    }
    for (const c of properties) {
      seen.get(width).add(`row page: ${c.type}`)
      results.push({ at, check: `row page ${c.type} value centred on its row: "${c.label}"`, ok: Math.abs(c.off) <= TOLERANCE, detail: px(c.off) })
      results.push({ at, check: `row page ${c.type} name centred on its row: "${c.label}"`, ok: Math.abs(c.name) <= TOLERANCE, detail: px(c.name) })
      results.push({ at, check: `row page ${c.type} value level with its name: "${c.label}"`, ok: Math.abs(c.against) <= TOLERANCE, detail: px(c.against) })
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
for (const [width, kinds] of seen) for (const kind of REQUIRED) if (!kinds.has(kind) && !((kind === 'peek' || kind === 'side peek' || kind === 'icon: sidebar' || kind === 'icon: timeline table') && width !== 1280)) results.push({ at: `${width}`, check: `${kind}: not on any measured page`, ok: 'missing', detail: 'add it to the copy and run again' })

const label = r => (r.ok === 'missing' ? 'MISSING' : r.ok ? 'ok' : 'FAIL').padEnd(7)
const show = args.includes('--all') ? results : results.filter(r => r.ok !== true)
for (const r of show) console.log(`${label(r)} ${r.at.padEnd(22)} ${r.check} · ${r.detail}`)
const passed = results.filter(r => r.ok === true).length, failed = results.filter(r => r.ok === false).length, missing = results.filter(r => r.ok === 'missing').length
console.log(`\n${passed} passed, ${failed} failed, ${missing} missing${args.includes('--all') ? '' : ' (passing checks not listed; --all lists them)'}`)
if (failed || missing) process.exitCode = 1
