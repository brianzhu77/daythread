// Brian 1ac6784b: the Templates list and a template page carry no explanatory sentences. Usage: node look.mjs <base> (blank store).
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2], out = new URL('.', import.meta.url).pathname
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
for (const [name, br, w, h] of [['chromium', chromium, 1280, 900], ['webkit', webkit, 390, 844]]) for (const scheme of ['light', 'dark']) {
  const b = await br.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', colorScheme: scheme, viewport: { width: w, height: h }, ...(w === 390 ? { isMobile: true, hasTouch: true } : {}) })
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message))
  const tag = `${name}-${w}-${scheme}`
  await p.goto(`${base}/pages?view=templates`); await p.getByRole('heading', { name: 'Templates' }).waitFor(); await p.waitForLoadState('networkidle')
  const main = p.locator('.list-screen')
  const text = await main.innerText()
  ok(!/start with|start from|copied empty/.test(text), `${tag} list: no explanatory sentence`)
  ok((await p.locator('.card-row').first().innerText()).replace(/\s+/g, ' ').trim().startsWith('Day Default for day pages'), `${tag} list: first row is Day · Default for day pages`)
  await main.screenshot({ path: `${out}/${tag}-list.png` })
  // The template page itself: title, Default for, then the body; no grey sentence.
  await p.locator('.card-row').first().click(); await p.locator('.template-target').waitFor(); await p.waitForTimeout(400)
  ok(!(await p.locator('.template-screen').innerText()).includes('start from'), `${tag} template page: no explanatory line`)
  await p.locator('.template-screen').screenshot({ path: `${out}/${tag}-template.png` })
  ok(!errs.length, `${tag} no page errors ${errs.join(' | ')}`)
  await b.close()
}
process.exitCode = fail ? 1 : 0
