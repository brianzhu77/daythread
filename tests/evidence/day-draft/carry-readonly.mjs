// Lead/Ratchet/Bumblebee 22:12Z: a carried to-do's band is read-only. No text cursor, a tap or typing can't change it,
// and Apply sends no edit for it; a new to-do's band stays editable, and line keys there keep the caret in the band (not
// in his row). Usage: node carry-readonly.mjs <chromium base> <webkit base> (two blank stores).
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const bases = { chromium: process.argv[2], webkit: process.argv[3] }
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
for (const [name, br, w, h] of [['chromium', chromium, 1280, 900], ['webkit', webkit, 390, 844]]) {
  const b = await br.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h }, ...(w === 390 ? { isMobile: true, hasTouch: true } : {}) })
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(e.message) })
  const tag = `${name} ${w}`
  await p.goto(`${bases[name]}/`); await p.locator('.continuous-editor .bn-block-outer').first().waitFor(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(400)
  // A real task: type into the template's empty to-do row, then read its task id from the row.
  const row = p.locator('.continuous-editor .bn-block-content[data-content-type=task]').first()
  await row.locator('.bn-inline-content').click(); await p.keyboard.type('Existing carry', { delay: 20 }); await p.waitForTimeout(1500)
  const ids = await p.evaluate(() => {
    const c = document.querySelector('.continuous-editor .bn-block-content[data-content-type=task]')
    const outer = c?.closest('.bn-block-outer')
    return { anchor: outer?.dataset.id, taskId: c?.getAttribute('data-task-id') ?? c?.querySelector('[data-task-id]')?.getAttribute('data-task-id') }
  })
  ok(Boolean(ids.anchor && ids.taskId), `${tag}: real task row ${JSON.stringify(ids)}`)
  await p.evaluate(ids => {
    window.__daythreadDraft = { '*': { state: 'ready', planningEndId: ids.anchor, moreOpen: [], items: [
      { id: 'carry', kind: 'after', anchorId: ids.anchor, since: '2026-10-23', block: { id: 'bc', type: 'task', props: { taskId: ids.taskId }, content: [{ type: 'text', text: 'Stale copy', styles: {} }] } },
      { id: 'fresh', kind: 'after', anchorId: ids.anchor, block: { id: 'bf', type: 'task', props: {}, content: [{ type: 'text', text: 'New one', styles: {} }] } },
    ] } }; window.__daythreadDraftBump()
  }, ids); await p.waitForTimeout(400)
  const carry = p.locator('.draft-band[data-draft-item=carry] .draft-text'), fresh = p.locator('.draft-band[data-draft-item=fresh] .draft-text')
  ok((await carry.textContent()) === 'Existing carry', `${tag}: carried band shows the task's live title`)
  const look = await carry.evaluate(e => ({ ce: e.isContentEditable, cursor: getComputedStyle(e).cursor }))
  ok(!look.ce && look.cursor === 'default', `${tag}: carried band not editable, default cursor ${JSON.stringify(look)}`)
  ok(await fresh.evaluate(e => e.isContentEditable), `${tag}: new to-do band still editable`)
  if (w === 390) await carry.tap(); else await carry.click()
  await p.keyboard.type(' renamed'); await p.waitForTimeout(200)
  const after = await carry.evaluate(e => ({ text: e.textContent, focusIn: e.closest('.draft-band').contains(document.activeElement), shadow: getComputedStyle(e).boxShadow }))
  ok(after.text === 'Existing carry' && !after.focusIn && after.shadow === 'none', `${tag}: tap + typing leave it unchanged, no focus line ${JSON.stringify(after)}`)
  const rowText = () => row.locator('.editor-task-title').textContent()
  // ⌘→/⌘← are a Mac's line end/start (End/Home scroll there); End is pressed too, since it was the key that moved the
  // caret into his row before the fix (the editor's task-row line rule ran on keys from the band).
  await fresh.click(); await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.type(' edited'); await p.keyboard.press('Meta+ArrowLeft'); await p.keyboard.type('A ')
  await p.keyboard.press('End'); await p.keyboard.type('!'); await p.waitForTimeout(300)
  const got = [await fresh.textContent(), await rowText()]
  ok(got[0].replace('!', '') === 'A New one edited' && got[1] === 'Existing carry', `${tag}: line keys in a new band stay in it, his row unchanged ${JSON.stringify(got)}`)
  await p.evaluate(() => { window.__daythreadDraftLog = [] }); await p.locator('.draft-line .draft-primary', { hasText: 'Apply all' }).click(); await p.waitForTimeout(200)
  const logged = await p.evaluate(() => window.__daythreadDraftLog)
  const e = logged[0]?.edits ?? {}
  ok(logged[0]?.apply?.includes('carry') && !('carry' in e) && e.fresh?.replace('!', '') === 'A New one edited', `${tag}: Apply all sends no edit for the carried band, keeps the new one's ${JSON.stringify(logged)}`)
  ok(errs.length === 0, `${tag}: no page errors ${errs.join(' | ')}`)
  await b.close()
}
console.log(fail ? `${fail} FAIL` : 'all pass'); process.exit(fail ? 1 : 0)
