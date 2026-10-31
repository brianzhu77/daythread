// B76 bands on a real today page with the stand-in draft. Usage: node look.mjs <base> (blank store, built-in template).
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2], out = new URL('.', import.meta.url).pathname
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const pad = n => String(n).padStart(2, '0'), d = new Date(), iso = x => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
for (const [name, br, w, h] of [['chromium', chromium, 1280, 900], ['webkit', webkit, 390, 844]]) for (const scheme of ['light', 'dark']) {
  const b = await br.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', colorScheme: scheme, viewport: { width: w, height: h }, ...(w === 390 ? { isMobile: true, hasTouch: true } : {}) })
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(e.message) })
  const tag = `${name}-${w}-${scheme}`
  await p.goto(`${base}/`); await p.locator('.continuous-editor .bn-block-outer').first().waitFor(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(400)
  // Anchors from the real page: the empty to-do under TODO (fill), the last Notes bullet (after), the Notes heading.
  const ids = await p.evaluate(() => {
    const outers = [...document.querySelectorAll('.continuous-editor .bn-block-outer')]
    const type = o => o.querySelector('.bn-block-content')?.getAttribute('data-content-type')
    const text = o => o.querySelector('.bn-block-content')?.textContent?.trim() ?? ''
    const todo = outers.find(o => type(o) === 'task'); const notesH = outers.find(o => type(o) === 'heading' && /Notes/.test(text(o)))
    const bullets = outers.filter(o => type(o) === 'bulletListItem'); return { todo: todo?.dataset.id, notes: notesH?.dataset.id, lastBullet: bullets.at(-1)?.dataset.id, firstBullet: bullets[0]?.dataset.id }
  })
  ok(Boolean(ids.todo && ids.lastBullet), `${tag} found anchors ${JSON.stringify(ids)}`)
  const set = draft => p.evaluate(draft => { window.__daythreadDraft = { '*': draft }; window.__daythreadDraftBump() }, draft)
  const since = iso(new Date(d.getTime() - 8 * 864e5))
  const draft = { state: 'ready', planningEndId: ids.todo, items: [
    { id: 'i1', kind: 'fill', anchorId: ids.todo, block: { id: 'b1', type: 'task', props: {}, content: [{ type: 'text', text: '填完 TRV 申请表第一页', styles: {} }] } },
    { id: 'i2', kind: 'after', anchorId: ids.todo, since, block: { id: 'b2', type: 'task', props: {}, content: [{ type: 'text', text: 'TRV for Lu and Kathy — a long title that has to wrap on the phone', styles: {} }] } },
    { id: 'i3', kind: 'after', anchorId: ids.lastBullet, block: { id: 'b3', type: 'bulletListItem', props: {}, content: [{ type: 'text', text: '不追新闻；午饭后不开 Slack', styles: {} }] } },
  ], moreOpen: [{ taskId: 't9', title: '换护照照片', since }] }
  await set({ ...draft, state: 'preparing', items: [] }); await p.waitForTimeout(200)
  ok((await p.locator('.draft-line').innerText()).includes('Preparing'), `${tag} preparing line`); await p.screenshot({ path: `${out}/${tag}-1preparing.png` })
  await set(draft); await p.waitForTimeout(400)
  ok(await p.locator('.draft-band').count() === 3, `${tag} 3 bands`)
  ok((await p.locator('.draft-line').innerText()).replace(/\s+/g, ' ').includes('3 suggestions · Apply all · Dismiss'), `${tag} ready line`)
  ok(!(await p.locator(`.continuous-editor .bn-block-outer[data-id="${ids.todo}"]`).isVisible()), `${tag} the filled empty to-do is hidden`)
  // Geometry: a band's box and text sit where his own to-do row's would. Compare with a real task row (temporarily unhide).
  const geo = await p.evaluate(id => {
    const band = document.querySelector('.draft-band.is-task'), bb = band.querySelector('.draft-box').getBoundingClientRect(), bt = band.querySelector('.draft-text').getBoundingClientRect()
    const st = document.querySelector('style:not([data-x])'); const outer = document.querySelector(`.continuous-editor .bn-block-outer[data-id="${id}"]`); outer.style.setProperty('display', 'block', 'important')
    const box = outer.querySelector('.editor-task input').getBoundingClientRect(), title = outer.querySelector('.editor-task-title').getBoundingClientRect(); outer.style.removeProperty('display')
    return { boxDx: Math.round((bb.left - box.left) * 10) / 10, textDx: Math.round((bt.left - title.left) * 10) / 10 }
  }, ids.todo)
  ok(Math.abs(geo.boxDx) <= 1 && Math.abs(geo.textDx) <= 1, `${tag} band box and text line up with his to-do row ${JSON.stringify(geo)}`)
  const bullet = await p.evaluate(id => { const t = document.querySelector('.draft-band.is-bullet .draft-text').getBoundingClientRect(); const o = document.querySelector(`.continuous-editor .bn-block-outer[data-id="${id}"] .bn-inline-content`).getBoundingClientRect(); return Math.round((t.left - o.left) * 10) / 10 }, ids.lastBullet)
  ok(Math.abs(bullet) <= 1, `${tag} bullet band text lines up with his bullet text (dx ${bullet})`)
  ok(await p.evaluate(() => document.documentElement.scrollWidth) <= w, `${tag} no sideways scroll`)
  const icons = await p.evaluate(() => [...document.querySelectorAll('.draft-acts svg')].map(s => { const r = s.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}` }))
  ok(icons.length === 6 && icons.every(i => i === '16x16'), `${tag} Apply and Skip icons are 16x16 ${JSON.stringify(icons)}`)
  await p.screenshot({ path: `${out}/${tag}-2ready.png`, fullPage: true })
  await p.locator('.draft-more-toggle').click(); await p.waitForTimeout(150); await p.screenshot({ path: `${out}/${tag}-3more.png`, fullPage: true })
  // Apply one, then failed state with the rest.
  await p.locator('.draft-band[data-draft-item=i1] button[aria-label^=Apply]').click(); await p.waitForTimeout(200)
  ok(await p.locator('.draft-band').count() === 2 + 1 && (await p.locator(`.continuous-editor .bn-block-outer[data-id="${ids.todo}"]`).isVisible()), `${tag} apply one: band gone, its anchor back (mock inserts nothing)`)
  await p.evaluate(() => { window.__daythreadDraft['*'].state = 'failed'; window.__daythreadDraftBump() }); await p.waitForTimeout(150)
  ok((await p.locator('.draft-line').innerText()).replace(/\s+/g, ' ').includes('2 suggestions · Apply all · Dismiss · Couldn’t draft · Retry'), `${tag} failed line keeps the fallback bands`)
  await p.screenshot({ path: `${out}/${tag}-4failed.png` })
  // Arrived while typing: type, then the draft arrives; held until Show, and Show keeps the view.
  await set({ state: 'none', items: [], moreOpen: [], planningEndId: null }); await p.waitForTimeout(150)
  await p.locator(`.continuous-editor .bn-block-outer[data-id="${ids.firstBullet}"] .bn-inline-content`).click(); await p.keyboard.type('typing', { delay: 30 })
  await p.evaluate(() => { window.__daythreadDraftSeen = undefined })
  await set(draft); await p.waitForTimeout(300)
  const heldLine = (await p.locator('.draft-line').innerText()).replace(/\s+/g, ' ')
  ok(heldLine.includes('Suggestions ready · Show') && await p.locator('.draft-band').count() === 0, `${tag} held while typing: "${heldLine}"`)
  await p.screenshot({ path: `${out}/${tag}-5held.png` })
  const caretTop = async () => p.evaluate(id => document.querySelector(`.continuous-editor .bn-block-outer[data-id="${id}"]`).getBoundingClientRect().top, ids.firstBullet)
  const before = await caretTop(); await p.locator('.draft-line button', { hasText: 'Show' }).click(); await p.waitForTimeout(300)
  const after = await caretTop()
  ok(await p.locator('.draft-band').count() > 0 && Math.abs(after - before) <= 1, `${tag} Show reveals and keeps the line in view (moved ${Math.round(after - before)}px)`)
  ok(!errs.length, `${tag} no page errors ${errs.join(' | ')}`)
  await b.close()
}
process.exitCode = fail ? 1 : 0
