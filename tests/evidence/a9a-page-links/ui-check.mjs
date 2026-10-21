// A9a `[[` + B15 in the built app (vite preview) on a copy of Brian's database: Jazz page-links-states §6 checks
// 1–6 and 8–10, plus the plan's §7 browser cases (IME composition and the extra input after it, paste, in-app copy,
// lines shown outside the editor). A real Chinese input method is NOT used: composition is simulated with events.
//   node ui-check.mjs <base url> <db path> <pristine copy> <shots dir> <playwright index.mjs>
import { copyFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const [base, dbPath, pristine, out, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const today = '2026-10-20', R = 'fa95e8a3-dd0a-4b3c-8fcc-c1129c8c4820' // 韩国大酱汤, a child of Sun Oct 18
const errors = []
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
const reset = () => { for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true }); copyFileSync(pristine, dbPath) }
const sql = q => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare(q).all() } finally { d.close() } }
const sections = id => JSON.parse(sql(`SELECT sections FROM pages WHERE snapshot='current' AND id='${id}'`)[0].sections)
const refsOn = id => sections(id).flatMap(s => s.blocks).flatMap(b => (b.refs ?? []).map(r => ({ ...r, blockId: b.id })))
const b = await chromium.launch()
async function open(path = '/', width = 1280) {
  const p = await b.newPage({ viewport: { width, height: 900 } })
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await p.goto(`${base}${path}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
  return p
}
const block = (p, id) => p.locator(`.bn-block-outer[data-id="${id}"]`)
const clickLine = (p, id) => block(p, id).locator('.bn-inline-content').first().click()
const menu = p => p.locator('.bn-suggestion-menu')
const menuText = async p => (await menu(p).count()) ? (await menu(p).first().innerText()) : ''
const chips = (p, id) => block(p, id).locator('.page-ref')
const settle = p => p.waitForTimeout(1300)
const notes = `day:${today}:notes:template:0`
const linkedFromText = async p => (await p.locator('.linked-from').first().innerText().catch(() => '')).replace(/\s+/g, ' ')

// 1. `做法参考 [[韩` → 韩国大酱汤 "in Sun, Oct 18" → Enter → inline, words intact → open → its Linked from shows Today.
reset()
let p = await open()
await clickLine(p, notes); await p.keyboard.type('做法参考 [[韩'); await p.waitForTimeout(500)
const m1 = await menuText(p)
log(m1.includes('韩国大酱汤') && m1.includes('in Sun, Oct 18'), '1. the list shows 韩国大酱汤 "in Sun, Oct 18"', m1.replace(/\n/g, ' / '))
await p.keyboard.press('Enter'); await p.keyboard.type(' 里的配料'); await settle(p)
log(await chips(p, notes).count() === 1 && (await block(p, notes).innerText()).replace(/\s+/g, '').includes('做法参考韩国大酱汤里的配料'), '   the link sits inline with the words around it')
let refs = refsOn(`day:${today}`)
log(refs.length === 1 && refs[0].pageId === R && refs[0].title === '韩国大酱汤', '   saved as a reference with its own refId and time', JSON.stringify(refs[0] ?? null))
log(await chips(p, notes).first().evaluate(el => getComputedStyle(el).textDecorationLine) !== 'underline' && await chips(p, notes).first().evaluate(el => getComputedStyle(el).color) !== 'rgb(0, 0, 238)', '   it doesn\'t look like a web link')
await p.screenshot({ path: `${out}/1280-link.png` })
await chips(p, notes).first().click(); await p.waitForTimeout(800)
log(new URL(p.url()).searchParams.get('page') === R, '   tapping it opens 韩国大酱汤')
log(/Today/.test(await linkedFromText(p)), '   its Linked from shows Today', await linkedFromText(p))

// 3. Rename 韩国大酱汤 → today's link shows the new name, with no edit to today.
const beforeRename = sql(`SELECT editorJSON FROM pages WHERE snapshot='current' AND id='day:${today}'`)[0].editorJSON
await p.locator('.page-head [contenteditable], .page-head input, .page-title-field').first().click()
await p.keyboard.press('Meta+a'); await p.keyboard.type('大酱汤（正宗）'); await p.keyboard.press('Enter'); await settle(p)
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
log((await chips(p, notes).first().innerText()).includes('大酱汤（正宗）'), '3. after a rename the link shows the new name')
log(sql(`SELECT editorJSON FROM pages WHERE snapshot='current' AND id='day:${today}'`)[0].editorJSON === beforeRename, '   today\'s page wasn\'t edited by the rename')

// 4. Trash it → muted with the bin icon, opens the trashed page with Restore; `[[` no longer lists it; Restore → live.
await p.goto(`${base}/pages?page=${R}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
await p.getByRole('button', { name: 'Page actions' }).first().click(); await p.waitForTimeout(200)
await p.getByRole('menuitem', { name: 'Delete' }).first().click(); await settle(p)
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
log(await chips(p, notes).first().evaluate(el => el.classList.contains('is-trashed')), '4. trashed: the link is muted with the bin icon')
await clickLine(p, `day:${today}:events:template:0`); await p.keyboard.type('[[大酱'); await p.waitForTimeout(500)
log(!(await menuText(p)).includes('大酱汤（正宗）'), '   `[[` no longer lists the trashed page', (await menuText(p)).replace(/\n/g, ' / '))
await p.keyboard.press('Escape'); await settle(p)
await chips(p, notes).first().click(); await p.waitForTimeout(800)
log((await p.locator('body').innerText()).includes('Restore'), '   tapping it opens the trashed page with Restore')
await p.getByRole('button', { name: 'Restore' }).first().click(); await settle(p)
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
log(await chips(p, notes).first().evaluate(el => el.classList.contains('is-live')), '   Restore → the link is live again')
await p.close()

// 5. `[[新页面` → New page → live link, the page under today in Subpages, still on today; ⌘Z → link goes, page stays.
reset(); p = await open()
await clickLine(p, notes); await p.keyboard.type('[[新页面'); await p.waitForTimeout(500)
const m5 = await menuText(p)
log(m5.includes('New page "新页面"'), '5. the list ends with New page "新页面"', m5.replace(/\n/g, ' / '))
await p.getByText('New page "新页面"').click(); await settle(p)
const made = sql("SELECT id, title, parentId FROM pages WHERE snapshot='current' AND title='新页面'")
log(made.length === 1 && made[0].parentId === `day:${today}`, '   a page "新页面" is made under today', JSON.stringify(made))
log(new URL(p.url()).pathname === '/' && await chips(p, notes).first().evaluate(el => el.classList.contains('is-live')), '   he stays on today and the link is live')
log((await p.locator('.subpages').innerText().catch(() => '')).includes('新页面'), '   it\'s in today\'s Subpages')
await p.keyboard.press('Meta+z'); await settle(p)
log(await chips(p, notes).count() === 0 && sql("SELECT id FROM pages WHERE snapshot='current' AND title='新页面'").length === 1, '   ⌘Z removes the link; the page stays')
await p.close()

// 6. Backspace removes a link whole, and today leaves the target's Linked from.
reset(); p = await open()
await clickLine(p, notes); await p.keyboard.type('[[韩'); await p.waitForTimeout(400); await p.keyboard.press('Enter'); await settle(p)
// After choosing, a space follows the link; one Backspace takes the space, the next takes the whole link.
await p.keyboard.press('Backspace'); await p.waitForTimeout(200)
log(await chips(p, notes).count() === 1, '6. a space follows the link, so the cursor can sit after it')
await p.keyboard.press('Backspace'); await settle(p)
log(await chips(p, notes).count() === 0 && (await block(p, notes).innerText()).trim() === '', '   one more Backspace removes the whole link')
log(refsOn(`day:${today}`).length === 0, '   and today is no longer a reference')
await p.close()

// 10 + IME: Esc and `]]` leave plain text; nothing in a task row; paste doesn't open; composition opens once, after it ends.
reset(); p = await open()
await clickLine(p, notes); await p.keyboard.type('[[abc'); await p.waitForTimeout(400); await p.keyboard.press('Escape'); await p.waitForTimeout(300)
log((await block(p, notes).innerText()).trim() === '[[abc' && !(await menu(p).count()), '10. Esc leaves exactly "[[abc"')
await p.keyboard.press('Enter'); await p.keyboard.type('[[x]]'); await p.waitForTimeout(400)
log(!(await menu(p).count()), '    typing `]]` closes it and leaves plain text')
await clickLine(p, `day:${today}:other:template:0`); await p.keyboard.type('[['); await p.waitForTimeout(400)
log(!(await menu(p).count()), '    `[[` in a task row opens nothing', `${await menu(p).count()} ${(await menuText(p)).slice(0, 80)} | focus in: ${await p.evaluate(() => document.activeElement?.closest?.('.bn-block-outer')?.getAttribute('data-id') ?? document.activeElement?.className)}`)
await p.keyboard.press('Escape')
await clickLine(p, `day:${today}:events:template:0`)
await p.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', '[['); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) })
await p.waitForTimeout(400)
log(!(await menu(p).count()), '    pasting `[[` opens nothing')
await p.close()
reset(); p = await open()
await clickLine(p, notes)
const ed = p.locator('.bn-editor').first()
await ed.dispatchEvent('compositionstart', { data: '' })
await p.keyboard.insertText('【【'); await p.waitForTimeout(400)
log(!(await menu(p).count()), 'IME: nothing opens while composing')
await ed.dispatchEvent('compositionend', { data: '【【' }); await p.waitForTimeout(400)
log(await menu(p).count() === 1, '    after compositionend the list opens', String(await menu(p).count()))
await ed.dispatchEvent('input', { inputType: 'insertCompositionText', data: '【【' }); await p.waitForTimeout(400)
log(await menu(p).count() === 1, '    the extra input after compositionend doesn\'t open it twice')
await p.keyboard.type('韩'); await p.waitForTimeout(400)
log((await menuText(p)).includes('韩国大酱汤'), '    and it searches what follows `【【`')
await p.keyboard.press('Escape'); await p.waitForTimeout(300)
log((await block(p, notes).innerText()).trim() === '【【韩', '    Esc leaves exactly "【【韩"', JSON.stringify((await block(p, notes).innerText()).trim()))
await p.keyboard.press('Enter')
await ed.dispatchEvent('compositionstart', { data: '' }); await ed.dispatchEvent('compositionend', { data: '' }); await p.waitForTimeout(300)
log(!(await menu(p).count()), '    a cancelled composition opens nothing')
await p.keyboard.type('['); await p.keyboard.insertText('【'); await p.waitForTimeout(300)
log(!(await menu(p).count()), '    `[` then `【` is not a trigger')
await p.close()

// In-app copy of a line with a link → a new reference (new refId); the original keeps its time.
reset(); p = await open()
await clickLine(p, notes); await p.keyboard.type('see [[韩'); await p.waitForTimeout(400); await p.keyboard.press('Enter'); await settle(p)
const node = JSON.parse(sql(`SELECT editorJSON FROM pages WHERE snapshot='current' AND id='day:${today}'`)[0].editorJSON).find(n => n.id === notes)
await clickLine(p, `day:${today}:events:template:0`)
await p.evaluate(n => { const dt = new DataTransfer(); dt.setData('application/x-daythread-blocks', JSON.stringify({ blocks: [n], cut: false, token: 'copy' })); dt.setData('text/plain', 'see'); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, node)
await settle(p)
refs = refsOn(`day:${today}`)
const original = refs.find(r => r.refId === node.content.find(c => c.type === 'pageRef').props.refId), copied = refs.find(r => r !== original)
log(refs.length === 2 && original && copied && copied.refId !== original.refId && copied.at > original.at, 'in-app copy of a line with a link: a new refId and a newer time', JSON.stringify(refs.map(r => [r.refId.slice(0, 6), r.at])))
await p.close()

// 8 (B15). X = 佛卡夏披萨: linked from Oct 18's card already; link it from Oct 19 then today → "Today, Mon Oct 19, …"; a move keeps it.
reset(); p = await open('/day/2026-10-19')
const X = 'ee5bd493-980f-4041-ad34-89efa85ed78a'
const oct19Line = (await p.evaluate(() => [...document.querySelectorAll('.bn-block-outer')].map(el => ({ id: el.getAttribute('data-id'), t: el.innerText.trim(), type: el.querySelector('[data-content-type]')?.getAttribute('data-content-type') })))).find(x => x.type === 'bulletListItem' && !x.t) ?? { id: null }
if (oct19Line.id) { await clickLine(p, oct19Line.id); await p.keyboard.type('[[佛卡'); await p.waitForTimeout(400); await p.keyboard.press('Enter'); await settle(p) }
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
await clickLine(p, notes); await p.keyboard.type('[[佛卡'); await p.waitForTimeout(400); await p.keyboard.press('Enter'); await settle(p)
await p.goto(`${base}/pages?page=${X}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
const lf1 = await linkedFromText(p)
log(/Today.*Mon, Oct 19/.test(lf1), '8. B15: Linked from reads Today, then Mon Oct 19', lf1)
await p.getByRole('button', { name: 'Page actions' }).first().click(); await p.waitForTimeout(200)
await p.getByRole('menuitem', { name: 'Move to…' }).first().click(); await p.waitForTimeout(400)
const target = p.locator('.move-row').filter({ hasText: /^(?!.*Sun).*$/ }).first()
await target.click().catch(() => {}); await settle(p)
await p.goto(`${base}/pages?page=${X}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
log((await linkedFromText(p)).replace(/Sun, Oct 18 ?/, '').trim() === lf1.replace(/Sun, Oct 18 ?/, '').trim(), '   after Move, the order is unchanged', await linkedFromText(p))
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
// Click past the end of the line (not on the chip, which opens its page), then Backspace removes the link.
// The caret at the very end of the line (after the space that follows the link), set as a DOM range so no click can
// land on the chip and open its page; then Backspace takes the space and the link.
await block(p, notes).locator('.bn-inline-content').first().evaluate(el => { (el.closest('[contenteditable="true"]')).focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r) })
await p.waitForTimeout(100)
await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); await settle(p)
await p.goto(`${base}/pages?page=${X}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
log(!/Today/.test(await linkedFromText(p)) && /Mon, Oct 19/.test(await linkedFromText(p)), '   delete today\'s link → Today leaves, Mon Oct 19 stays', await linkedFromText(p))
await p.close()

// Ranking (Ratchet 4703f076): a title starting with the query comes before one that only contains it.
reset(); p = await open(); await p.close() // the copy is upgraded on first open
{
  const d = new DatabaseSync(dbPath)
  // Two pages straight in the copy (the server reads the file on each command).
  const tpl = d.prepare("SELECT * FROM pages WHERE snapshot='current' AND type='document' LIMIT 1").get()
  for (const [id, title, pos] of [['rk-other', 'other needle', 900], ['rk-start', 'needle start', 901]]) {
    const row = { ...tpl, id, title, position: pos, parentId: null }
    const names = Object.keys(row)
    d.prepare(`INSERT INTO pages (${names.map(n => `"${n}"`).join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map(n => row[n]))
  }
  d.close()
}
p = await open()
await clickLine(p, notes); await p.keyboard.type('[[needle'); await p.waitForTimeout(500)
const rows = (await menuText(p)).split('\n').filter(l => /needle/.test(l) && !/New page/.test(l))
log(rows[0] === 'needle start' && rows[1] === 'other needle', 'ranking: the title starting with "needle" comes first', JSON.stringify(rows))
await p.keyboard.press('Escape')
await clickLine(p, `day:${today}:events:template:0`); await p.keyboard.type('[[Oct 19'); await p.waitForTimeout(500)
log(!(await menuText(p)).includes('\nDay'), 'a day row has no "Day" second line (Jazz)', (await menuText(p)).replace(/\n/g, ' / '))
await p.close()

// Lines outside the editor show the live title: a tagged line with a link on the Tags page after a rename.
reset(); p = await open()
await clickLine(p, notes); await p.keyboard.type('#recipe 参考 [[韩'); await p.waitForTimeout(400); await p.keyboard.press('Enter'); await settle(p)
await p.goto(`${base}/pages?page=${R}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
await p.locator('.page-head [contenteditable], .page-head input, .page-title-field').first().click()
await p.keyboard.press('Meta+a'); await p.keyboard.type('Doenjang jjigae'); await p.keyboard.press('Enter'); await settle(p)
await p.goto(`${base}/tags/recipe`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
log((await p.locator('.tag-screen').innerText()).includes('Doenjang jjigae'), 'Tags page: the line shows the link\'s current title')
await p.close()

// 9 + 390: a long Chinese title wraps with its line; the phone + menu has "Link to page".
reset(); p = await open('/', 390)
await clickLine(p, notes); await p.keyboard.type('今天 [[新'); await p.waitForTimeout(400)
await menu(p).getByText(/New page "/).first().click(); await settle(p)
await p.goto(`${base}/pages?page=${encodeURIComponent(sql("SELECT id FROM pages WHERE snapshot='current' AND title='新'")[0].id)}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
await p.locator('.page-head [contenteditable], .page-head input, .page-title-field').first().click()
await p.keyboard.press('Meta+a'); await p.keyboard.type('一个非常非常长的中文页面标题用来检查在窄屏上是否会随着这一行一起换行而不会溢出屏幕'); await p.keyboard.press('Enter'); await settle(p)
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
const box = await block(p, notes).boundingBox(), chipBoxes = await chips(p, notes).first().evaluate(el => [...el.getClientRects()].map(r => [Math.round(r.left), Math.round(r.right)]))
log(chipBoxes.length > 1 && chipBoxes.every(([l, r]) => l >= 0 && r <= 390), '9. at 390 a long title wraps with the line and never overflows', JSON.stringify(chipBoxes))
await p.screenshot({ path: `${out}/390-long-link.png` })
await clickLine(p, `day:${today}:events:template:0`)
await p.getByRole('button', { name: 'Insert block' }).click(); await p.waitForTimeout(300)
await p.keyboard.type('link'); await p.waitForTimeout(300)
log((await menuText(p)).includes('Link to page'), '390: the + menu has "Link to page"')
await p.keyboard.press('Enter'); await p.waitForTimeout(500)
log((await menuText(p)).length > 0 && await menu(p).count() === 1, '    which opens the same list')
await p.close()

log(errors.length === 0, 'no page or console errors', errors.slice(0, 3).join(' | '))
await b.close()
