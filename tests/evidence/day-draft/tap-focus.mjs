// Jazz design look on B76 (live 70f0e38): (1) a tap on a band's ✓/✕, "Apply all", "more open" or its ＋ never focuses
// the editor (on a phone that brings up the keyboard); a new to-do's text still takes the caret. (2) "more open" sits
// at the end of the planning part: after the built-in TODO slot; on his layout after "Intentional Drop / Slack" and its
// line, before the `---`. Usage: node tap-focus.mjs <built-in base> <his-template base> <blank base>; the first two
// serve a store with open to-dos and today = a new day (no draft model: the fallback), the third a blank store.
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const [builtin, his, blank] = process.argv.slice(2), out = new URL('.', import.meta.url).pathname
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const tz = process.env.TZ || 'Pacific/Kiritimati'
const editorFocused = p => p.evaluate(() => Boolean(document.activeElement?.closest?.('.continuous-editor')) && !document.activeElement.closest('.draft-host')?.querySelector('[contenteditable=true]:focus'))
const box = (p, sel) => p.locator(sel).first().evaluate(e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } })
const blockBox = (p, pred) => p.evaluate(pred => {
  const outers = [...document.querySelectorAll('.continuous-editor .bn-block-outer')]
  const o = outers.find(o => new Function('o', `return ${pred}`)(o)); const r = o?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom } : null
}, pred)
// Chromium first: the phone run's ＋ takes the built-in store's open to-do.
for (const [name, br, w, h] of [['chromium', chromium, 1280, 900], ['webkit', webkit, 390, 844]]) {
  const tag = `${name} ${w}`, phone = w === 390
  const open = async base => {
    const b = await br.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', timezoneId: tz, viewport: { width: w, height: h }, ...(phone ? { isMobile: true, hasTouch: true } : {}) })
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(e.message) })
    await p.goto(`${base}/`); await p.locator('.continuous-editor .bn-block-outer').first().waitFor(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(800)
    return { b, p, errs }
  }
  // Blur first: the desktop page puts the caret in the editor on load, so measure what the tap itself does.
  const tap = async (p, loc) => { await p.evaluate(() => document.activeElement?.blur?.()); return phone ? loc.tap() : loc.click() }
  { // Built-in day: placement, then taps on "more open" and its ＋.
    const { b, p, errs } = await open(builtin)
    const toggle = p.locator('.draft-more-toggle'); await toggle.waitFor({ timeout: 10000 })
    const slot = await blockBox(p, `o.querySelector('[data-content-type=task]') && !o.querySelector('.bn-inline-content')?.textContent`)
    const more = await box(p, '.draft-more-toggle'), events = await blockBox(p, `o.querySelector('[data-content-type=heading]')?.textContent.trim() === 'Events'`)
    ok(slot && more.top >= slot.bottom - 1 && more.bottom <= events.top + 1, `${tag} built-in: "more open" after the TODO slot, above Events ${JSON.stringify({ slot, more, events })}`)
    await tap(p, toggle); await p.waitForTimeout(300)
    ok(!(await editorFocused(p)), `${tag} built-in: tapping "more open" leaves the editor unfocused`)
    await p.screenshot({ path: `${out}/tap-${name}-builtin.png` })
    if (phone) { await tap(p, p.locator('.draft-more .is-open-row button').first()); await p.waitForTimeout(500); ok(!(await editorFocused(p)), `${tag} built-in: tapping ＋ leaves the editor unfocused`) }
    ok(errs.length === 0, `${tag} built-in: no page errors ${errs.join(' | ')}`); await b.close()
  }
  { // His layout: after Intentional Drop / Slack and its line, before the divider; not inside Top 3.
    const { b, p, errs } = await open(his)
    await p.locator('.draft-more-toggle').waitFor({ timeout: 10000 })
    const more = await box(p, '.draft-more-toggle')
    const drop = await blockBox(p, `o.querySelector('[data-content-type=heading]')?.textContent.trim() === 'Intentional Drop / Slack'`)
    const hr = await blockBox(p, `o.querySelector('[data-content-type=divider]')`)
    const other = await blockBox(p, `o.querySelector('[data-content-type=heading]')?.textContent.trim() === 'Other - Outside the Tunnel'`)
    ok(drop && hr && more.top > drop.bottom + 10 && more.bottom <= hr.top + 1 && more.top > other.bottom, `${tag} his layout: "more open" after Intentional Drop's line, before the divider ${JSON.stringify({ drop, more, hr })}`)
    await p.locator('.draft-more-toggle').evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200)
    await p.screenshot({ path: `${out}/tap-${name}-his.png` })
    ok(errs.length === 0, `${tag} his layout: no page errors ${errs.join(' | ')}`); await b.close()
  }
  { // Bands (stand-in draft on a blank store): ✓, ✕ and Apply all never focus the editor; a new to-do's text does take the caret.
    const { b, p, errs } = await open(blank)
    const anchor = await p.evaluate(() => [...document.querySelectorAll('.continuous-editor .bn-block-outer')].find(o => o.querySelector('[data-content-type=task]'))?.dataset.id)
    const set = () => p.evaluate(a => { window.__daythreadDraft = { '*': { state: 'ready', planningEndId: a, moreOpen: [], items: ['x1', 'x2', 'x3', 'x4'].map(id => ({ id, kind: 'after', anchorId: a, block: { id: `b-${id}`, type: 'task', props: {}, content: [{ type: 'text', text: `Band ${id}`, styles: {} }] } })) } }; window.__daythreadDraftBump() }, anchor)
    await set(); await p.waitForTimeout(400)
    await tap(p, p.locator('.draft-band[data-draft-item=x1] button[title=Apply]')); await p.waitForTimeout(300)
    ok(!(await editorFocused(p)), `${tag} bands: tapping ✓ leaves the editor unfocused`)
    await tap(p, p.locator('.draft-band[data-draft-item=x2] button[title=Skip]')); await p.waitForTimeout(300)
    ok(!(await editorFocused(p)), `${tag} bands: tapping ✕ leaves the editor unfocused`)
    await tap(p, p.locator('.draft-band[data-draft-item=x3] .draft-text')); await p.waitForTimeout(300)
    ok(await p.evaluate(() => document.activeElement?.closest?.('.draft-band')?.dataset.draftItem === 'x3'), `${tag} bands: tapping a new to-do's text puts the caret in it`)
    await tap(p, p.locator('.draft-line .draft-primary', { hasText: 'Apply all' })); await p.waitForTimeout(300)
    ok(!(await editorFocused(p)), `${tag} bands: tapping Apply all leaves the editor unfocused`)
    ok(errs.length === 0, `${tag} bands: no page errors ${errs.join(' | ')}`); await b.close()
  }
}
console.log(fail ? `${fail} FAIL` : 'all pass'); process.exit(fail ? 1 : 0)
