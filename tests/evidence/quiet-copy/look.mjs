// Brian 1ac6784b: no explanatory lines. Usage: node look.mjs <blank-store base> <sample-data base>.
// The second base gets sample data from the banner on its first run.
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const [blank, data] = process.argv.slice(2), out = new URL('.', import.meta.url).pathname
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const gone = /A page for each day|come along|Use \+ to start|Type to search|Search looks at|keep typing to narrow|Type # and a word|Deleted pages stay here|Shown at current status|plan ahead|notes written here|Checkbox that becomes|The body of your document|Larger than day sections/
const pad = n => String(n).padStart(2, '0'), d = new Date(Date.now() + 9 * 864e5), future = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
for (const [name, br, w, h] of [['chromium', chromium, 1280, 900], ['webkit', webkit, 390, 844]]) for (const scheme of ['light', 'dark']) {
  const b = await br.launch(); const ctx = await b.newContext({ serviceWorkers: 'block', colorScheme: scheme, viewport: { width: w, height: h }, ...(w === 390 ? { isMobile: true, hasTouch: true } : {}) })
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errs.push(e.message) })
  const tag = `${name}-${w}-${scheme}`, shot = s => p.screenshot({ path: `${out}/${tag}-${s}.png` })
  const body = async () => (await p.locator('body').innerText())
  const visit = async (url, s, ready) => { await p.goto(url); await ready(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(300); ok(!gone.test(await body()), `${tag} ${s}: no explanatory line`); await shot(s) }
  // Blank store: first day, empty Pages, Tags, Trash, a future day.
  await visit(`${blank}/`, 'today-blank', () => p.locator('.bn-editor').first().waitFor())
  await visit(`${blank}/pages`, 'pages-empty', () => p.locator('.list-screen').getByText('No pages yet').waitFor())
  await visit(`${blank}/tags`, 'tags-empty', () => p.getByText('No tags yet').waitFor())
  await visit(`${blank}/day/${future}`, 'future-day', () => p.getByRole('button', { name: 'Create page' }).waitFor())
  // Sample data: Today with the Tomorrow block, Trash, search, the slash menu.
  await p.goto(`${data}/`); await p.waitForLoadState('networkidle')
  if (await p.locator('details.banner summary').count()) { await p.locator('details.banner summary').click(); await p.getByRole('button', { name: 'Add sample data' }).click(); await p.getByText('Sample data added').waitFor() }
  await visit(`${data}/`, 'today-data', () => p.locator('.editor-task').first().waitFor())
  await visit(`${data}/pages?view=trash`, 'trash', () => p.getByRole('heading', { name: 'Trash' }).waitFor())
  await p.goto(`${data}/`); await p.locator('.editor-task').first().waitFor(); await p.waitForLoadState('networkidle')
  if (w === 1280) await p.keyboard.press('Meta+k'); else await p.getByRole('button', { name: /search/i }).first().click()
  const input = p.getByPlaceholder('Search'); await input.waitFor()
  ok(true, `${tag} search placeholder is "Search"`); await p.waitForTimeout(300)
  ok(!gone.test(await p.locator('.search-dialog').innerText()), `${tag} search, nothing typed: no hint`); await shot('search-empty')
  await input.fill('zzqqxx'); await p.waitForTimeout(500)
  const none = await p.locator('.search-dialog').innerText()
  ok(none.includes('Nothing matches') && !gone.test(none), `${tag} search, no match: just "Nothing matches"`); await shot('search-none')
  await p.goto(`${data}/`); await p.locator('.editor-task').first().waitFor(); await p.waitForLoadState('networkidle')
  // Slash menu: titles only.
  const lastBullet = p.locator('.bn-block-content[data-content-type="bulletListItem"]').last()
  await lastBullet.click(); await p.keyboard.press('End'); await p.keyboard.press('Enter'); await p.keyboard.type('/')
  const menu = p.locator('.bn-suggestion-menu'); await menu.waitFor()
  ok(!gone.test(await menu.innerText()) && !(await menu.locator('.bn-mt-suggestion-menu-item-subtitle').count()), `${tag} slash menu: titles only`); await shot('slash')
  await p.keyboard.press('Escape'); await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace')
  ok(!errs.length, `${tag} no page errors ${errs.join(' | ')}`)
  await b.close()
}
process.exitCode = fail ? 1 : 0
