// B23 checks (docs/design/save-conflict-states.md §3) with two tabs on a fresh copy of Brian's data.
//   node check.mjs <base url> <db copy> <playwright index.mjs>
import { DatabaseSync } from 'node:sqlite'
const [base, dbPath, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const DAY = '2026-10-18'
let failures = 0
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) failures++ }
const q = (sql, ...a) => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare(sql).all(...a) } finally { d.close() } }
const doc = () => JSON.parse(q("SELECT editorJSON FROM pages WHERE snapshot='current' AND type='daily' AND date=?", DAY)[0].editorJSON)
const txt = c => Array.isArray(c) ? c.map(x => x.type === 'pageRef' ? '[[link]]' : x.text ?? txt(x.content)).join('') : ''
const flat = (ns, out = []) => { for (const n of ns) { out.push(n); flat(n.children ?? [], out) } return out }
const lines = () => flat(doc()).map(n => `${n.type === 'task' ? '[] ' : ''}${txt(n.content)}`)
const count = s => lines().filter(l => l.includes(s)).length
const browser = await chromium.launch(), errors = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
const open = async (width = 1280) => { const p = await ctx.newPage(); await p.setViewportSize({ width, height: width < 600 ? 844 : 1000 }); p.on('pageerror', e => errors.push(e.message)); await p.goto(`${base}/day/${DAY}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000); return p }
const row = (p, text) => p.locator('.continuous-editor .bn-inline-content').filter({ hasText: text }).first()
const typeAt = async (p, text, add) => { await p.bringToFront(); await row(p, text).click(); await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.type(add) }
const saveLine = p => p.locator('.editor-save-line')
const settle = p => p.waitForTimeout(1600)
const written = () => flat(doc()).filter(n => n.type === 'bulletListItem' && txt(n.content).trim()).map(n => txt(n.content))
const [L2, L5] = [written()[0], written()[3]]
console.log('lines used:', JSON.stringify(L2), JSON.stringify(L5))

// 1. Conflict: A changes L5 and saves, then B (still on the old page) types in L2.
let A = await open(), B = await open()
await typeAt(A, L5, ' [A1]'); await settle(A)
await typeAt(B, L2, ' [B1]'); await settle(B)
const line1 = await saveLine(B).innerText()
log(/Changed in another tab · draft kept/.test(line1) && /Load latest/.test(line1), '1. B shows the conflict line with Load latest', line1.replace(/\n/g, ' | '))
log(!/Retry saving|Copy draft/.test(line1), '1. no Retry and no Copy draft on a conflict')
log(count('[A1]') === 1 && count('[B1]') === 0, '1. the database has A\'s edit, not B\'s')

// 2. Load latest: A's L5 stays, B's text is right below L2, nothing duplicated or undone; notice and caret.
await saveLine(B).getByRole('button', { name: 'Load latest' }).click(); await settle(B)
const after2 = lines(), i2 = after2.findIndex(l => l === L2), j2 = after2.findIndex(l => l.includes('[B1]'))
log(count('[A1]') === 1 && after2.includes(`${L5} [A1]`), '2. A\'s edit kept once')
log(i2 >= 0 && j2 === i2 + 1 && after2[j2] === `${L2} [B1]`, '2. B\'s line sits right below its line', `${i2} → ${j2}`)
const toast2 = (await B.locator('.toast').allInnerTexts()).join(' | ')
log(/Latest loaded · your changes are below their lines/.test(toast2) && /Undo/.test(toast2), '2. notice with Undo', toast2.replace(/\n/g, ' '))
const caretLine = await B.evaluate(() => getSelection().anchorNode?.parentElement?.closest('.bn-inline-content')?.textContent ?? '')
log(caretLine.includes('[B1]'), '2. caret on the inserted line', caretLine)
log(!/Changed in another tab/.test(await saveLine(B).innerText()), '2. the conflict line is gone')

// 3. Reload B: no conflict comes back.
await B.reload({ waitUntil: 'networkidle' }); await B.waitForTimeout(1200)
const line3 = await saveLine(B).innerText()
log(!/Changed in another tab|Recovered|draft kept/.test(line3), '3. reload: no conflict and no recovered draft', line3 || '(empty)')
log(count('[B1]') === 1 && count('[A1]') === 1, '3. both edits once in the database')
await A.close(); await B.close()

// 4. Tasks: B adds a task and renames an existing one while A edits elsewhere.
const taskRow = flat(doc()).find(n => n.type === 'task' && txt(n.content).trim())
const tasksBefore = q("SELECT id, title FROM tasks WHERE snapshot='current'")
if (!taskRow) log(false, '4. a task row exists on the page')
else {
  const title = txt(taskRow.content)
  A = await open(); B = await open()
  await typeAt(A, L5, ' [A4]'); await settle(A)
  await typeAt(B, title, ' renamed-B4'); await B.keyboard.press('Enter'); await B.keyboard.type('new task B4'); await settle(B)
  log(/Changed in another tab/.test(await saveLine(B).innerText()), '4. conflict shown')
  await saveLine(B).getByRole('button', { name: 'Load latest' }).click(); await settle(B)
  const tasksAfter = q("SELECT id, title FROM tasks WHERE snapshot='current'")
  const created = tasksAfter.filter(t => !tasksBefore.some(b => b.id === t.id))
  log(created.length === 1 && created[0].title === 'new task B4', '4. the new task exists once, as a task', JSON.stringify(created.map(t => t.title)))
  log(tasksAfter.find(t => t.id === taskRow.props.taskId)?.title === title, '4. the existing task keeps its title (no second task)')
  const plain = flat(doc()).find(n => txt(n.content) === `${title} renamed-B4`)
  log(plain?.type === 'bulletListItem', '4. B\'s new title is a bullet below it (Jazz fix 1)', plain?.type)
  const x = async text => Math.round((await row(B, text).boundingBox())?.x ?? -1)
  const xs = [await x(`${title} renamed-B4`), await x(L2)]
  log(xs[0] > 0 && Math.abs(xs[0] - xs[1]) <= 1, '4. it sits on the shared text column', `${xs[0]} vs a bullet at ${xs[1]}`)
  await A.close(); await B.close()
}

// 5. A deletes the line B was editing: B's text lands at the end of the page.
const L3 = written()[1]
A = await open(); B = await open()
await A.bringToFront(); await row(A, L3).click(); await A.keyboard.press('Meta+ArrowRight'); await A.keyboard.down('Shift'); await A.keyboard.press('Meta+ArrowLeft'); await A.keyboard.up('Shift')
const l3id = flat(doc()).find(n => txt(n.content) === L3)?.id
// Empty the text, turn the empty bullet into a plain line, then remove that line: the block itself is gone.
for (let k = 0; k < 3; k++) await A.keyboard.press('Backspace')
await settle(A)
log(Boolean(l3id) && !flat(doc()).some(n => n.id === l3id), '5. A deleted the line itself', JSON.stringify(L3))
await typeAt(B, L3, ' [B5]'); await settle(B)
await saveLine(B).getByRole('button', { name: 'Load latest' }).click(); await settle(B)
const last5 = flat(doc()).filter(n => txt(n.content).trim()).map(n => txt(n.content)).at(-1)
log(last5 === `${L3} [B5]`, '5. B\'s text is the last line of the page', last5)

// 6. Undo on the notice: the latest page exactly, without B's line.
const latest6 = (() => { const d = flat(doc()); return d.filter(n => !txt(n.content).includes('[B5]')).map(n => `${n.type}:${txt(n.content)}`) })()
await B.locator('.toast').getByRole('button', { name: 'Undo' }).click(); await settle(B)
log(JSON.stringify(flat(doc()).map(n => `${n.type}:${txt(n.content)}`)) === JSON.stringify(latest6), '6. Undo leaves the latest page exactly', `B5 left: ${count('[B5]')}`)
await A.close(); await B.close()

// 7. Network failure: "Couldn't save · draft kept · Retry saving · Copy draft", and Retry works afterwards.
B = await open()
await B.route('**/_serverFn/**', r => r.request().method() === 'POST' ? r.abort() : r.continue())
await typeAt(B, L2, ' [B7]'); await settle(B)
const line7 = await saveLine(B).innerText()
log(/Couldn't save · draft kept/.test(line7) && /Retry saving/.test(line7) && /Copy draft/.test(line7) && !/Load latest/.test(line7), '7. network failure line', line7.replace(/\n/g, ' | '))
await B.unroute('**/_serverFn/**')
await saveLine(B).getByRole('button', { name: 'Retry saving' }).click(); await settle(B)
log(count('[B7]') === 1, '7. Retry saves once the server is back')
await B.close()

// 8. 390: the conflict line and its button fit the screen.
A = await open(); B = await open(390)
await typeAt(A, L5, ' [A8]'); await settle(A)
await typeAt(B, L2, ' [B8]'); await settle(B)
const style = await saveLine(B).getByRole('button', { name: 'Load latest' }).evaluate(e => { const c = getComputedStyle(e), r = getComputedStyle(document.documentElement); return { weight: c.fontWeight, color: c.color, ink: getComputedStyle(Object.assign(document.body.appendChild(document.createElement('span')), { style: 'color: var(--ink)' })).color, size: getComputedStyle(e.parentElement).fontSize } })
log(style.weight === '600' && style.color === style.ink && style.size === '13px', '8. Load latest in ink, 600; status 13px (Jazz fix 2)', JSON.stringify(style))
const box = await saveLine(B).boundingBox(), btn = await saveLine(B).getByRole('button', { name: 'Load latest' }).boundingBox()
log(box && btn && box.x >= 0 && box.x + box.width <= 390 && btn.x + btn.width <= 390, '8. 390: line and button inside the screen', `line ${Math.round(box?.x)}–${Math.round((box?.x ?? 0) + (box?.width ?? 0))}, button ${Math.round(btn?.x)}–${Math.round((btn?.x ?? 0) + (btn?.width ?? 0))} h${Math.round(btn?.height ?? 0)}`)
await B.screenshot({ path: new URL('./conflict-390.png', import.meta.url).pathname })
await saveLine(B).getByRole('button', { name: 'Load latest' }).click(); await settle(B)
log(count('[B8]') === 1 && count('[A8]') === 1, '8. 390: Load latest keeps both')
log(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' / '))
await browser.close()
console.log(failures ? `${failures} failed` : 'all passed')
