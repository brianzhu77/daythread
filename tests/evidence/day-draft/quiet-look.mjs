// The quiet suggestion look (Brian 94c74a77, Lead 2f4bbcb7 look A; anything dashed isn't his yet, Bumblebee a14528a6):
// no filled box; muted ink; a dashed box, dot or underline per kind; ✓/✕ hover-only on the laptop, visible on the phone.
// Usage: node quiet-look.mjs <his-layout base> (his-template.ts store with an open to-do; today = a new day).
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2], out = new URL('.', import.meta.url).pathname
let fail = 0; const ok = (v, m) => { console.log(v ? 'PASS' : 'FAIL', m); if (!v) fail++ }
const tz = process.env.TZ || 'Pacific/Kiritimati'
for (const [name, br, w, h] of [['webkit', webkit, 390, 844], ['chromium', chromium, 1280, 900]]) for (const scheme of ['light', 'dark']) {
  const b = await br.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', colorScheme: scheme, timezoneId: tz, viewport: { width: w, height: h }, ...(w === 390 ? { isMobile: true, hasTouch: true } : {}) })
  const p = await ctx.newPage(); await p.goto(`${base}/`); await p.locator('.continuous-editor .bn-block-outer').first().waitFor(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(800)
  await p.evaluate(() => {
    const outers = [...document.querySelectorAll('.continuous-editor .bn-block-outer')]
    const ty = o => o.querySelector('.bn-block-content')?.getAttribute('data-content-type'), tx = o => o.querySelector('.bn-block-content')?.textContent?.trim()
    const after = t => outers[outers.findIndex(o => ty(o) === 'heading' && tx(o) === t) + 1]
    const slots = outers.filter(o => ty(o) === 'task'), ev = after('Events'), drop = after('Intentional Drop / Slack')
    const task = (id, t, extra = {}) => ({ id, kind: 'fill', block: { id: `b${id}`, type: 'task', props: {}, content: [{ type: 'text', text: t, styles: {} }] }, ...extra })
    const d = new Date(); d.setDate(d.getDate() - 9); const since = d.toISOString().slice(0, 10)
    window.__daythreadDraft = { '*': { state: 'ready', planningEndId: slots[0].dataset.id, moreOpenAfterId: drop.dataset.id, moreOpen: [{ taskId: 'm1', title: 'Calendar 页面', since }], items: [
      { id: 'e1', kind: 'fill', anchorId: ev.dataset.id, block: { id: 'be1', type: 'bulletListItem', props: {}, content: [{ type: 'text', text: '10:30 Dentist', styles: {} }] } },
      task('t1', '填完 TRV 申请表第一页', { anchorId: slots[0].dataset.id }),
      task('t2', 'TRV for Lu and Kathy', { anchorId: slots[1].dataset.id, since }),
      task('t4', 'Reply to the landlord about the lease', { anchorId: slots[3].dataset.id }),
      { id: 'l1', kind: 'fill', anchorId: drop.dataset.id, block: { id: 'bl1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Skip the gym today', styles: {} }] } },
    ] } }; window.__daythreadDraftBump()
  })
  await p.waitForTimeout(500)
  // Something he wrote, so a suggestion sits next to his own words.
  const slot3 = p.locator('.continuous-editor .bn-block-content[data-content-type=task]').nth(2).locator('.bn-inline-content')
  if (!(await slot3.textContent())?.trim()) await slot3.click(), await p.keyboard.type('Finish the slides for Monday', { delay: 5 }); await p.evaluate(() => document.activeElement?.blur?.()); await p.waitForTimeout(400)
  const top = await p.evaluate(() => { const h = [...document.querySelectorAll('.continuous-editor [data-content-type=heading]')].find(e => e.textContent.trim() === 'Morning Planning'); window.scrollTo(0, window.scrollY + h.getBoundingClientRect().top - 90); return true })
  const tag = `${name} ${w} ${scheme}`
  if (w > 600) await p.mouse.move(5, 5); await p.waitForTimeout(250)
  const st = await p.evaluate(() => {
    const cs = (sel, pseudo) => { const e = document.querySelector(sel); return e ? getComputedStyle(e, pseudo) : null }
    const band = cs('.draft-band[data-draft-item=t1]'), his = cs('.continuous-editor [data-content-type=task] .bn-inline-content')
    return { bg: band.backgroundColor, shadow: band.boxShadow, ink: band.color, hisInk: his?.color, box: cs('.draft-band[data-draft-item=t1] .draft-box').borderTopStyle,
      dot: cs('.draft-band[data-draft-item=e1]', '::before').borderTopStyle, line: cs('.draft-band[data-draft-item=l1] .draft-text').textDecorationStyle, acts: cs('.draft-band[data-draft-item=t1] .draft-acts').opacity }
  })
  ok((st.bg === 'rgba(0, 0, 0, 0)' || st.bg === 'transparent') && st.shadow === 'none', `${tag}: no filled box or bar ${JSON.stringify([st.bg, st.shadow])}`)
  ok(st.ink !== st.hisInk, `${tag}: muted ink, not his ${JSON.stringify([st.ink, st.hisInk])}`)
  ok(st.box === 'dashed' && st.dot === 'dashed' && st.line === 'dashed', `${tag}: to-do box, bullet dot and line underline dashed ${JSON.stringify([st.box, st.dot, st.line])}`)
  ok(w > 600 ? st.acts === '0' : st.acts === '1', `${tag}: ✓/✕ ${w > 600 ? 'hidden until hover' : 'visible on the phone'} (opacity ${st.acts})`)
  const lineDeco = await p.locator('.draft-line button').evaluateAll(bs => bs.map(b => getComputedStyle(b).textDecorationLine))
  ok(lineDeco.length > 0 && lineDeco.every(d => d === 'none'), `${tag}: the top line's buttons have no underline (only a line suggestion does) ${JSON.stringify(lineDeco)}`)
  if (w > 600) { await p.locator('.draft-band[data-draft-item=t1]').hover(); await p.waitForTimeout(250); ok(await p.locator('.draft-band[data-draft-item=t1] .draft-acts').evaluate(e => getComputedStyle(e).opacity) === '1', `${tag}: ✓/✕ show on hover`); await p.mouse.move(5, 5); await p.waitForTimeout(250) }
  await p.screenshot({ path: `${out}/quiet-${name}-${scheme}.png` })
  await b.close()
}
console.log(fail ? `${fail} FAIL` : 'all pass'); process.exit(fail ? 1 : 0)
