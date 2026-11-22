// Press check: every visible pressable control must show, under the finger or the mouse, that it is being pressed
// (docs/design/tap-feedback.md §1; Brian b6fc2a8f: "I press a button and can't tell whether it registered").
// The standing rule for every change that adds or restyles a control, next to scripts/check-alignment.mjs.
//
//   node scripts/check-press.mjs <base url> [path ...] [--all] [--run=<name part>] [--json=<file>] [--shots=<dir>] [--init=<file>]
//   e.g. node scripts/check-press.mjs http://127.0.0.1:3361
//   --all presses every control; without it, at most SAME_KIND controls of one kind per run (see 1).
//   --init adds a script to every page before it loads, to try a press rule before it is built into the app.
//
// Run it against a build serving a SQLite copy with scripts/align-fixtures.ts and then scripts/press-fixtures.ts
// applied (every row type on /day/2026-12-31, and a ready day draft on today). Never against real data: it clicks
// the controls that open a menu or a dialog. It is meant to save nothing, and it watches for that: any change it
// sends to the server is reported as CHANGED and fails the run, since the check itself then needs fixing.
//
// What it does, in three runs: Chromium 390 with real touch events; Chromium 1280 with the real mouse hovering and
// the press made in the page as mouse pointer events (a real mouse press can only be let go by a click or a drag,
// and either could change data); WebKit 390 with touch pointer events made in the page (it can't hold a real touch).
//   1. Lists every visible pressable control on each path (the spec's list: buttons, links, tabs, menu items, options,
//      switches, checkboxes; not text inputs or a native select), then opens each control that says it opens a menu
//      or a dialog (aria-haspopup, or a HeroUI trigger; not a plain fold, which can save a view's setting) or is named in OPENS, and
//      lists what appeared, one level deep. With the mouse, a control that only shows while its row is hovered (the
//      sidebar's row buttons, the draft's ✓ ✕) is found by hovering the row first. Controls of one kind (same tag, classes, role and the same three
//      parents) take the same CSS, so only the first SAME_KIND of a kind are pressed in a run; the rest are counted
//      as "same kind". A page of 500 table cells is then a few dozen presses.
//   2. Holds a press on each one and cancels it. A press is never released on the control, so nothing is clicked.
//      - shows: within 60 ms of the press the control (or the row it sits in) looks different. Two tests, both
//        required: its computed style changed, and enough pixels changed in a screenshot of the control (CHANGED_SHARE
//        of its box by at least DELTA in a colour channel), so a change nobody could see doesn't pass. With the mouse,
//        "different" is against the hover look, not the rest look.
//      - clears: 300 ms after the press is cancelled it looks as it did before. A press that sticks is a FAIL.
//   3. Presses each disabled control the same way: nothing visible may change in it.
//   4. Coverage. Every control kind in REQUIRED must have been pressed in the runs that name it; one that wasn't is
//      MISSING, never a pass. A control that couldn't be reached (off screen after scrolling, or under something else)
//      is UNREACHED, and also fails the check: add a path or a fixture so it can be pressed.
//
// Not covered: a press that is let go on the control. Letting go is a click to the app (some controls track the
// pointer themselves, so even a made-up pointerup opened a column's menu), so the 100 ms minimum and the fade are
// checked on a few safe controls by tests/evidence/tap-feedback/press-check.mjs: they are one module's timing, the same
// for every control, while the look checked here differs per control. Also not covered: keyboard presses
// (Space/Enter), which need real key events that would also run the action; a real
// iPhone; whether the result of the action shows (the spec's §2); and controls that only exist in a mode the check
// doesn't enter (a table's bulk bar while rows are selected, a menu inside a menu, the editor's slash menu).
// Editable text, drag handles and anything marked data-no-press are not pressed; the kinds skipped are printed, so
// nothing is excused out of sight.
// Exit code 1 on any FAIL, MISSING, UNREACHED or CHANGED.
import { chromium, webkit } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const [base, ...given] = args.filter(a => !a.startsWith('--'))
if (!base) { console.error('usage: node scripts/check-press.mjs <base url> [path ...] [--all] [--run=<name part>] [--json=<file>] [--shots=<dir>] [--init=<file>]'); process.exit(2) }
const every = args.includes('--all')
const paths = given.length ? given : ['/', '/pages', '/calendar', '/tasks', '/review', '/tags', '/day/2026-12-31', '/pages?page=fixture-icon-page']
const shots = flag('shots')
if (shots) mkdirSync(shots, { recursive: true })

const PRESSABLE = 'button, a[href], summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], [role=switch], [role=checkbox], input[type=checkbox], input[type=radio], label:has(input[type=checkbox])'
// Only the handle itself is excused (Jazz 41ad161d): a row that can be pressed and dragged, or a button inside a draggable block, shows its press.
// The app's handles are named here as the press layer names them (src/components/press.ts LEFT_ALONE): keep the two lists the same.
const SKIPPED = '[data-no-press], .drag-handle, .bn-drag-handle, [data-drag-handle], .editor-handle, .editor-touch-handle, .database-row-handle, .database-list-handle, .database-pane-handle, .database-lane-grip, .database-column-edge'
const PROPS = ['background-color', 'background-image', 'color', 'opacity', 'transform', 'scale', 'translate', 'box-shadow', 'border-top-color', 'outline-style', 'outline-color', 'filter', 'text-decoration-color', 'fill', 'stroke']
const DELTA = 6, CHANGED_SHARE = 0.04, CHANGED_MIN = 24, PAD = 6
const SHOWS_BY_MS = 60, CLEARS_BY_MS = 300, SAME_KIND = 3
// Controls that open something without saying so (no aria-haspopup). Only ones whose opening saves nothing.
const OPENS = '.tab-search, button.side-row, button.round-add, button.page-more'
const ALL_RUNS = [
  { name: 'chromium 390 touch', engine: chromium, width: 390, height: 844, touch: true, press: 'touch' },
  { name: 'chromium 1280 mouse', engine: chromium, width: 1280, height: 860, touch: false, press: 'pointer', pointerType: 'mouse' },
  { name: 'webkit 390 touch', engine: webkit, width: 390, height: 844, touch: true, press: 'pointer', pointerType: 'touch' },
]
const RUNS = ALL_RUNS.filter(r => !flag('run') || r.name.includes(flag('run')))
// A filter that matches nothing would press nothing and pass (Ratchet 5d5fc6c7).
if (!RUNS.length) { console.error(`--run=${flag('run')} matches no run. Runs: ${ALL_RUNS.map(r => r.name).join(', ')}`); process.exit(2) }
// Something to click before a path is listed, where a control only appears after a press that changes nothing stored.
// The selector must match that one control only: Apply all shares Show's class, and a setup step that pressed it would apply the draft.
const SETUP = [{ path: '/', click: 'button.draft-primary:text-is("Show")', why: 'Show reveals the day draft\'s suggestions' }]
// [kind, selector, runs it must be pressed in ('' = every run)]
const REQUIRED = [
  ['draft ✓', '.draft-acts button[title="Apply"]', ''],
  ['draft ✕', '.draft-acts button[title="Skip"]', ''],
  ['draft Apply all / Dismiss', '.draft-line button', ''],
  ['to-do checkbox', '.editor-task [role=checkbox], .editor-task input[type=checkbox], .editor-task .task-check', ''],
  ['tab bar tab', '.tab-capsule a, .tab-capsule button', '390'],
  ['tab bar Search', '.tab-search', '390'],
  ['sidebar row', '.tree-row a, .tree-row button, .sidebar a', '1280'],
  ['page card', '.card-row, .card-row a', ''],
  ['menu item', '[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option]', ''],
  ['HeroUI button', '[data-slot=button], button[data-react-aria-pressable]', ''],
]

/** In the page: tag every visible pressable not yet tagged; return what was tagged. */
function tagControls([selector, skipped, from, inside, opens, hovering]) {
  const name = e => [e.tagName.toLowerCase(), ...[...e.classList].sort()].join('.') + (e.getAttribute('role') ? `[${e.getAttribute('role')}]` : '') + (e.getAttribute('data-slot') ? `{${e.getAttribute('data-slot')}}` : '')
  const kindOf = e => { const up = []; for (let p = e.parentElement, k = 0; p && k < 3 && p !== document.body; p = p.parentElement, k++) up.push(name(p)); return [name(e) + (e.getAttribute('type') ? `:${e.getAttribute('type')}` : ''), ...up].join(' < ') }
  const visible = e => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e)
    return r.width > 2 && r.height > 2 && !readerOnly(e) && s.visibility !== 'hidden' && s.display !== 'none' && (e.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true)
  }
  // visually hidden, for a screen reader only (itself or the wrapper that clips it)
  const readerOnly = e => { for (let p = e, k = 0; p && k < 3; p = p.parentElement, k++) { const s = getComputedStyle(p); if (s.position === 'absolute' && (s.clip !== 'auto' || s.clipPath.startsWith('inset(50%'))) return true } return false }
  // what an opened menu or sheet covers isn't inside it: on screen, and something else is on top at its centre
  const behind = e => { const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false; const hit = document.elementFromPoint(x, y); return !hit || !(e.contains(hit) || hit.contains(e)) }
  // shown only while a row around it is hovered: hidden now, inside something that is visible
  const hoverOnly = e => { if (!hovering || readerOnly(e)) return false; for (let p = e.parentElement, k = 0; p && k < 4 && p !== document.body; p = p.parentElement, k++) if (visible(p)) return true; return false }
  const label = e => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 40)
  const out = []
  let i = from
  for (const e of document.querySelectorAll(selector)) {
    if (e.hasAttribute('data-press-check')) continue
    const hover = !visible(e)
    if (hover && !hoverOnly(e)) continue
    if (inside && behind(e)) continue
    // a checkbox inside its label is pressed through the label
    if (e.matches('input') && e.closest('label')?.matches(selector)) continue
    const id = String(i++)
    e.setAttribute('data-press-check', id)
    const disabled = e.matches(':disabled, [aria-disabled=true], [data-disabled=true]') || !!e.closest('[aria-disabled=true], fieldset:disabled') || getComputedStyle(e).pointerEvents === 'none'
    const state = e.isContentEditable ? 'editable' : e.matches(skipped) || e.closest(skipped) ? 'skipped' : disabled ? 'disabled' : 'live'
    out.push({ id, state, inside, hover, kind: `${inside ? 'inside ' : ''}${kindOf(e)}`, tag: e.tagName.toLowerCase(), cls: (e.getAttribute('class') || '').trim().split(/\s+/).slice(0, 3).join('.'), label: label(e),
      opens: state === 'live' && !inside && (e.hasAttribute('aria-haspopup') && e.getAttribute('aria-haspopup') !== 'false' || e.getAttribute('aria-expanded') === 'false' && e.matches('[data-react-aria-pressable], [data-rac]') || e.matches(opens)) })
  }
  return out
}

/** In the page: the look of a control, as computed style of itself, its pseudo-elements, its children and the rows around it. */
function signature([id, props]) {
  const el = document.querySelector(`[data-press-check="${id}"]`)
  if (!el) return null
  const take = (e, pseudo) => { const s = getComputedStyle(e, pseudo); return props.map(p => s.getPropertyValue(p)).join('|') }
  const name = e => `${e.tagName.toLowerCase()}${e.classList[0] ? '.' + e.classList[0] : ''}`
  const parts = [['itself', take(el)], ['itself::before', take(el, '::before')], ['itself::after', take(el, '::after')]]
  let n = 0
  for (const c of el.querySelectorAll('*')) { if (n++ > 25) break; parts.push([`inside ${name(c)}`, take(c)]) }
  // a small button tints the row it sits in (spec §1.3), so three levels up count too
  for (let p = el.parentElement, k = 0; p && k < 3 && p !== document.body; p = p.parentElement, k++) parts.push([`around ${name(p)}`, take(p)], [`around ${name(p)}::before`, take(p, '::before')], [`around ${name(p)}::after`, take(p, '::after')])
  return JSON.stringify(parts)
}

/** In the page: where to press a control, and whether that point is really on it. */
function target([id, scroll]) {
  const el = document.querySelector(`[data-press-check="${id}"]`)
  if (!el) return null
  if (scroll) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
  const s = getComputedStyle(el)
  if (r.width <= 2 || r.height <= 2 || s.visibility === 'hidden' || !(el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true)) return { reach: 'hidden' }
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { reach: 'off screen' }
  const hit = document.elementFromPoint(x, y)
  const over = hit?.closest('[data-press-check]')
  if (!hit || !(el.contains(hit) || over && over.contains(el))) return { reach: `under ${hit ? hit.tagName.toLowerCase() + '.' + (hit.getAttribute('class') || '').split(/\s+/)[0] : 'nothing'}` }
  return { reach: 'ok', x, y, box: { x: r.left, y: r.top, width: r.width, height: r.height } }
}

/** In the page: a point on the nearest visible thing around a control that only shows on hover. */
function rowPoint(id) {
  const el = document.querySelector(`[data-press-check="${id}"]`)
  for (let p = el?.parentElement, k = 0; p && k < 4 && p !== document.body; p = p.parentElement, k++) {
    const r = p.getBoundingClientRect()
    if (r.width <= 2 || r.height <= 2) continue
    p.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    const q = p.getBoundingClientRect()
    return { x: q.left + Math.min(12, q.width / 2), y: q.top + q.height / 2 }
  }
  return null
}

/** In the page: touch pointer events made by hand, for an engine that can't hold a real touch. */
function pointer([id, type, x, y, onDocument, pointerType]) {
  const el = document.querySelector(`[data-press-check="${id}"]`)
  const at = onDocument ? document.documentElement : document.elementFromPoint(x, y) ?? el
  const size = pointerType === 'mouse' ? 1 : 20
  at?.dispatchEvent(new PointerEvent(type, { pointerId: pointerType === 'mouse' ? 1 : 7, pointerType, isPrimary: true, bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerdown' ? 1 : 0, width: size, height: size, pressure: type === 'pointerdown' ? 0.5 : 0 }))
}

/** In a blank page: how many pixels of two screenshots differ by DELTA or more in a colour channel. */
async function pixelDiff([a, b, delta]) {
  const read = async b64 => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const k = new OffscreenCanvas(img.width, img.height).getContext('2d')
    k.drawImage(img, 0, 0)
    return k.getImageData(0, 0, img.width, img.height)
  }
  const [p, q] = [await read(a), await read(b)]
  if (p.width !== q.width || p.height !== q.height) return { changed: -1, total: p.width * p.height, most: 0 }
  let changed = 0, most = 0
  for (let i = 0; i < p.data.length; i += 4) {
    const d = Math.max(Math.abs(p.data[i] - q.data[i]), Math.abs(p.data[i + 1] - q.data[i + 1]), Math.abs(p.data[i + 2] - q.data[i + 2]))
    if (d >= delta) changed++
    if (d > most) most = d
  }
  return { changed, total: p.width * p.height, most }
}

/** What differs between two looks, for a failure's line: "itself: background-image; around div.row: background-color". */
const differs = (a, b) => {
  const [x, y] = [JSON.parse(a), JSON.parse(b)]
  if (x.length !== y.length) return 'its contents changed'
  return x.flatMap(([label, value], i) => { const [u, v] = [value.split('|'), y[i][1].split('|')]; const props = PROPS.filter((_, n) => u[n] !== v[n]); return props.length ? [`${label}: ${props.join(', ')}`] : [] }).slice(0, 4).join('; ')
}
const results = []
const changes = [] // commands the check itself sent: there should be none
const lines = []
const say = line => { lines.push(line); console.log(line) }

for (const run of RUNS) {
  const browser = await run.engine.launch()
  const context = await browser.newContext({ viewport: { width: run.width, height: run.height }, hasTouch: run.touch, isMobile: run.touch && run.engine === chromium, deviceScaleFactor: 1, reducedMotion: 'no-preference', timezoneId: 'America/Vancouver' })
  if (flag('init')) await context.addInitScript({ path: flag('init') })
  const page = await context.newPage()
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/_serverFn/') && (request.postData() ?? '').includes('"operationId"')) changes.push(`${run.name} ${page.url().slice(base.length)}`) })
  const lab = await context.newPage()
  const pressed = new Map(), opened = new Set() // per kind in this run
  const sample = c => { if (every || c.state === 'disabled') return true; return (pressed.get(c.kind) ?? 0) < SAME_KIND }
  const count = r => { if (r.result === 'PASS' || r.result === 'FAIL') pressed.set(r.kind, (pressed.get(r.kind) ?? 0) + 1); return r }
  await page.bringToFront()
  const cdp = run.press === 'touch' ? await context.newCDPSession(page) : null
  const wait = ms => page.waitForTimeout(ms)
  const look = id => page.evaluate(signature, [id, PROPS])
  const shot = async box => {
    const clip = { x: Math.max(0, box.x - PAD), y: Math.max(0, box.y - PAD), width: Math.min(run.width, box.x + box.width + PAD) - Math.max(0, box.x - PAD), height: Math.min(run.height, box.y + box.height + PAD) - Math.max(0, box.y - PAD) }
    return (await page.screenshot({ clip, animations: 'allow', caret: 'hide' })).toString('base64')
  }
  const diff = (a, b) => lab.evaluate(pixelDiff, [a, b, DELTA])
  const down = async (id, x, y) => {
    if (run.press === 'touch') await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    else await page.evaluate(pointer, [id, 'pointerdown', x, y, false, run.pointerType])
  }
  const cancel = async (id, x, y) => {
    if (run.press === 'touch') await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    else await page.evaluate(pointer, [id, 'pointercancel', x, y, false, run.pointerType])
  }
  const open = async path => {
    await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => {})
    await wait(900)
    for (const step of SETUP) if (step.path === path && await page.locator(step.click).first().isVisible().catch(() => false)) { await page.locator(step.click).first().click(); await wait(300) }
  }

  /** Press one tagged control and judge it. */
  const press = async (path, c, reopen) => {
    const row = { run: run.name, path, ...c }
    const escape = () => (reopen ? null : page.keyboard.press('Escape').catch(() => {})) // Escape would close the overlay being pressed
    const mouse = run.pointerType === 'mouse'
    let park = { x: 1, y: 1 } // where the mouse rests when it isn't on the control
    const reach = async () => {
      if (c.hover) { // shown only while its row is hovered
        park = await page.evaluate(rowPoint, c.id)
        if (!park) return { reach: 'hidden' }
        await page.mouse.move(park.x, park.y); await wait(200)
      }
      // wait for an opening menu or a scroll to come to rest: the same place twice, 100 ms apart
      let t = await page.evaluate(target, [c.id, !c.hover])
      for (let k = 0; k < 8 && t; k++) { await wait(100); const again = await page.evaluate(target, [c.id, false]); if (JSON.stringify(again) === JSON.stringify(t)) break; t = again }
      return t
    }
    let t = await reach()
    if (reopen && t && t.reach !== 'ok') { await reopen(); t = await reach() }
    if (!t) return { ...row, result: 'gone' }
    if (t.reach === 'hidden') return { ...row, result: 'hidden' }
    if (t.reach !== 'ok') return { ...row, result: c.state === 'disabled' ? 'ok' : 'UNREACHED', why: t.reach }
    // With the mouse the press is judged against the hover look. A disabled control isn't hovered: its tooltip would count as a change.
    if (mouse) { await page.mouse.move(park.x, park.y); await wait(80) }
    if (mouse && c.state !== 'disabled') { await page.mouse.move(t.x, t.y); await wait(160) }
    // the look at rest (or hovered) must itself be still: a menu fading in isn't a press
    let before = await look(c.id)
    for (let k = 0; k < 8; k++) { await wait(100); const again = await look(c.id); if (again === before) break; before = again }
    const before1 = await shot(t.box), before2 = await shot(t.box)
    const noise = (await diff(before1, before2)).changed
    await down(c.id, t.x, t.y)
    await wait(SHOWS_BY_MS)
    const held = await look(c.id)
    const during = held === null ? null : await shot(t.box)
    await cancel(c.id, t.x, t.y)
    await wait(CLEARS_BY_MS)
    const after = await look(c.id)
    await escape() // a control that opens on press-down
    if (held === null) return { ...row, result: 'gone' }
    const px = await diff(before2, during)
    const need = Math.max(CHANGED_MIN, Math.round(px.total * CHANGED_SHARE))
    const seen = px.changed - noise >= need
    Object.assign(row, { styleChanged: held !== before, changedPx: px.changed, needPx: need, noisePx: noise, most: px.most })
    if (c.state === 'disabled') return { ...row, result: seen ? 'FAIL' : 'ok', why: seen ? 'a disabled control reacts to a press' : '' }
    let why = ''
    if (held === before) why = 'nothing changes while pressed'
    else if (!seen) why = `the change can't be seen (${px.changed} of ${px.total} px, needs ${need})`
    else if (after !== null && after !== before) why = `still looks pressed ${CLEARS_BY_MS} ms after the press ended (${differs(before, after)})`
    if (why && shots) for (const [name, b64] of [['before', before2], ['pressed', during]]) writeFileSync(`${shots}/${run.name.replace(/ /g, '-')}-${c.id}-${name}.png`, Buffer.from(b64, 'base64'))
    return { ...row, result: why ? 'FAIL' : 'PASS', why }
  }

  for (const path of paths) {
    await open(path)
    const here = page.url()
    const back = async () => { if (page.url() !== here) { await open(path); await page.evaluate(tagControls, [PRESSABLE, SKIPPED, 0, '', OPENS, run.pointerType === 'mouse']) } }
    const controls = await page.evaluate(tagControls, [PRESSABLE, SKIPPED, 0, '', OPENS, run.pointerType === 'mouse'])
    let next = controls.length
    const started = Date.now()
    process.stderr.write(`${run.name} ${path}: ${controls.length} controls`)
    for (const c of controls) {
      if (c.state === 'editable' || c.state === 'skipped') { results.push({ run: run.name, path, ...c, result: c.state }); continue }
      if (!sample(c)) { results.push({ run: run.name, path, ...c, result: 'same kind' }); continue }
      const kinds = await page.evaluate(([id, req]) => { const e = document.querySelector(`[data-press-check="${id}"]`); return e ? req.filter(([, sel]) => e.matches(sel)).map(([kind]) => kind) : [] }, [c.id, REQUIRED])
      results.push(count({ ...(await press(path, c)), kinds }))
      await back()
      if (!c.opens || (!every && opened.has(`${c.kind} | ${c.label}`))) continue
      opened.add(`${c.kind} | ${c.label}`)
      // open it, press what appeared, close it
      const opener = page.locator(`[data-press-check="${c.id}"]`)
      if (!(await opener.isVisible().catch(() => false))) continue
      await opener.click({ timeout: 2000 }).catch(() => {})
      await wait(350)
      const inside = await page.evaluate(tagControls, [PRESSABLE, SKIPPED, next, c.label || c.cls, OPENS, false])
      next += inside.length
      // A press can close what was opened. Open it again and give the same controls, in the same order, their ids back.
      const reopen = async () => {
        await page.keyboard.press('Escape').catch(() => {})
        await wait(200)
        await back()
        await opener.click({ timeout: 2000 }).catch(() => {})
        await wait(350)
        await page.evaluate(([sel, skipped, from, label, ids]) => {
          for (const e of document.querySelectorAll('[data-press-check]')) if (ids.includes(e.getAttribute('data-press-check'))) e.removeAttribute('data-press-check')
        }, [PRESSABLE, SKIPPED, 0, '', inside.map(x => x.id)])
        await page.evaluate(tagControls, [PRESSABLE, SKIPPED, Number(inside[0].id), c.label || c.cls, OPENS, false])
      }
      for (const d of inside) {
        if (d.state === 'editable' || d.state === 'skipped') { results.push({ run: run.name, path, ...d, result: d.state }); continue }
        if (!sample(d)) { results.push({ run: run.name, path, ...d, result: 'same kind' }); continue }
        const kinds = await page.evaluate(([id, req]) => { const e = document.querySelector(`[data-press-check="${id}"]`); return e ? req.filter(([, sel]) => e.matches(sel)).map(([kind]) => kind) : [] }, [d.id, REQUIRED])
        results.push(count({ ...(await press(path, { ...d, opens: false }, reopen)), kinds }))
      }
      await page.keyboard.press('Escape').catch(() => {})
      await wait(150)
      if (await opener.getAttribute('aria-expanded').catch(() => null) === 'true') { await opener.click({ timeout: 2000 }).catch(() => {}); await wait(200) }
      await back()
      // a dialog that Escape doesn't close would cover everything after it: load the path again
      if (inside.length && await page.locator(inside.map(d => `[data-press-check="${d.id}"]`).join(', ')).first().isVisible().catch(() => false)) { await open(path); await page.evaluate(tagControls, [PRESSABLE, SKIPPED, 0, '', OPENS, run.pointerType === 'mouse']) }
      process.stderr.write(` +${inside.length}`)
    }
    process.stderr.write(` in ${Math.round((Date.now() - started) / 1000)} s\n`)
  }
  await browser.close()
}

const where = r => `${r.run} ${r.path}${r.inside ? ` > ${r.inside}` : ''}: ${r.tag}${r.cls ? '.' + r.cls : ''} "${r.label}"`
for (const r of results) {
  if (r.result === 'FAIL') say(`FAIL ${where(r)}: ${r.why}`)
  if (r.result === 'UNREACHED') say(`UNREACHED ${where(r)}: ${r.why}`)
}
for (const [kind, , only] of REQUIRED) for (const run of RUNS) {
  if (only && !run.name.includes(only)) continue
  if (!results.some(r => r.run === run.name && r.kinds?.includes(kind) && (r.result === 'PASS' || r.result === 'FAIL'))) say(`MISSING ${run.name}: no "${kind}" was pressed`)
}
for (const run of RUNS) {
  const mine = results.filter(r => r.run === run.name), count = what => mine.filter(r => r.result === what).length
  say(`${run.name}: ${count('PASS')} pass, ${count('FAIL')} fail, ${count('UNREACHED')} unreached, ${count('ok')} disabled and quiet, ${count('same kind')} same kind as one pressed, ${count('skipped') + count('editable')} skipped, ${count('gone') + count('hidden')} not on screen`)
}
const excused = [...new Set(results.filter(r => r.result === 'skipped').map(r => `${r.tag}${r.cls ? '.' + r.cls : ''}`))]
if (excused.length) say(`skipped as drag handles or data-no-press: ${excused.join(', ')}`)
if (flag('json')) writeFileSync(flag('json'), JSON.stringify(results, null, 1))
if (changes.length) say(`CHANGED the check itself sent ${changes.length} change${changes.length === 1 ? '' : 's'} to the server (first on ${changes[0]}): fix the check, and use a fresh copy`)
const bad = lines.filter(l => /^(FAIL|MISSING|UNREACHED|CHANGED)/.test(l)).length
say(bad ? `press check: ${bad} FAIL, MISSING, UNREACHED or CHANGED` : 'press check: every pressed control shows its press')
process.exit(bad ? 1 : 0)
