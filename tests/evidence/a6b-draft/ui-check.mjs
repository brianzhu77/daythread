// A6b step 1 in the built app (vite preview) with the fake model (scripts/fake-openrouter.mjs) on a seeded copy of
// Brian's database (seed.ts). Jazz morning-model-states §5 checks 1–7 plus failures, Done while drafting and expiry.
//   node ui-check.mjs <base url> <fake url> <db path> <pristine copy> <today> <shots dir> <playwright index.mjs>
import { copyFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const [base, fakeUrl, dbPath, pristine, today, out, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const errors = []
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
const reset = () => { for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true }); copyFileSync(pristine, dbPath) }
const mode = m => fetch(`${fakeUrl}/__draft-mode?mode=${m}`, { method: 'POST' })
const sql = q => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare(q).all() } finally { d.close() } }
const attempts = () => sql('SELECT id, state FROM model_attempts').filter(a => a.id.startsWith('draft:'))
const b = await chromium.launch()
async function open(width = 1280) {
  const p = await b.newPage({ viewport: { width, height: 900 } })
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  return p
}
const card = p => p.locator('.start-the-day')
const waitText = (p, text, ms = 15000) => card(p).getByText(text, { exact: false }).first().waitFor({ timeout: ms }).then(() => true, () => false)

// 1. Open and reload: no model call. Then Draft my day → drafted task and the proposal.
reset(); await mode('propose')
let p = await open()
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500)
log(attempts().length === 0, '1. opening and reloading today makes no model call')
log(await waitText(p, 'No suggestions from last night'), 'card offers "Draft my day"')
await card(p).getByRole('button', { name: 'Draft my day' }).click()
log(await waitText(p, 'Drafting your day', 3000), '2. "Drafting your day…" while it runs')
log(await waitText(p, 'From your notes'), '2. result: From your notes')
log(await waitText(p, '明天给 Kevin 回电话') && !(await card(p).getByText('奥德赛 第二章').count()), '   the line that names a day is proposed, the other isn\'t')
log(await waitText(p, 'Unfinished · from Mon') && !(await card(p).getByText('Drafted for today').count()), '   a picked task already on the card keeps "Unfinished · from Mon" (Lead, Jazz 9127710)')
log(await waitText(p, '1 line from', 3000), '   the proposed lines leave "lines from Mon" (3 → 1, Jazz c3a84702)')
// A dated proposal: planned for its day, no row today (Bumblebee, Lead, Jazz 9127710).
await card(p).getByRole('button', { name: /Add 周五交材料 as a task/ }).click(); await p.waitForTimeout(800)
log(await waitText(p, 'Added for Fri, Oct 23', 3000), '   dated + → "Added for Fri, Oct 23 · Undo"')
log(sql("SELECT plannedOn FROM tasks WHERE snapshot='current' AND title='周五交材料'")[0]?.plannedOn === '2026-10-23', '   the task is planned for Fri, Oct 23')
log(attempts().length === 1 && attempts()[0].state === 'settled', '   one call, cost settled', JSON.stringify(attempts()))
await p.screenshot({ path: `${out}/1280-drafted.png` })
// 5. + on the proposal: one task with his exact line, in TODO - Other; Undo removes it; the line is untouched.
const prevLine = () => sql("SELECT sections FROM pages WHERE snapshot='current' AND sections LIKE '%seed-1%'")[0].sections
const lineBefore = prevLine()
await card(p).getByRole('button', { name: /Add 明天给 Kevin 回电话 as a task/ }).click(); await p.waitForTimeout(800)
log(await waitText(p, 'Added to TODO - Other'), '5. + → "Added to TODO - Other · Undo"')
log(sql("SELECT title, plannedOn FROM tasks WHERE snapshot='current' AND title='明天给 Kevin 回电话'").length === 1, '   one task with his exact line')
log(prevLine() === lineBefore, '   the source line is unchanged')
await card(p).getByRole('button', { name: 'Undo' }).first().click(); await p.waitForTimeout(800)
log(sql("SELECT 1 FROM tasks WHERE snapshot='current' AND title='明天给 Kevin 回电话'").length === 0 && await waitText(p, '明天给 Kevin 回电话', 3000), '   Undo removes it and offers the line again')
// The drafted task goes to TODO - Other, never Top 3.
const draftedAdd = card(p).locator('.mc-row', { hasText: 'Drafted for today' }).locator('.mc-add')
if (await draftedAdd.count()) { await draftedAdd.first().click(); await p.waitForTimeout(800); log(await waitText(p, 'Added to TODO - Other', 3000), '   + on a drafted task → TODO - Other') }
// 6. Editing the source line removes its row, with no new call.
await p.goto(`${base}/day/${sql("SELECT date FROM pages WHERE snapshot='current' AND sections LIKE '%seed-1%'")[0].date}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
await p.locator('.bn-block-outer[data-id="seed-1"] .bn-inline-content').click(); await p.keyboard.press('End'); await p.keyboard.type(' 了'); await p.waitForTimeout(2000)
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
log(!(await card(p).getByText('明天给 Kevin 回电话').count()) && attempts().length === 1, '6. editing the line removes its row; no new model call')
await p.close()

// 4. Nothing to suggest: the card says so, no link, also after reload.
reset(); await mode('empty')
p = await open()
await card(p).getByRole('button', { name: 'Draft my day' }).click()
log(await waitText(p, 'Nothing to suggest today'), '4. "Nothing to suggest today"')
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800)
log(await waitText(p, 'Nothing to suggest today', 3000) && !(await card(p).getByRole('button', { name: 'Draft my day' }).count()), '   reload keeps it, no link back')
await p.screenshot({ path: `${out}/1280-nothing.png` })
await p.close()

// 3. Failures: key rejected and unavailable show their line with Retry; Retry is a new run.
for (const [m, text, costUnknown] of [['http401', 'Model key rejected · nothing was added', false], ['http500', 'Model unavailable · nothing was added', true], ['invalid', 'Model unavailable · nothing was added', false]]) {
  reset(); await mode(m)
  p = await open()
  await card(p).getByRole('button', { name: 'Draft my day' }).click()
  log(await waitText(p, text), `3. ${m}: "${text}"`)
  log(await card(p).getByRole('button', { name: 'Retry' }).count() === 1, '   with Retry')
  log(Boolean(await card(p).getByText('Cost unknown').count()) === costUnknown, `   "Cost unknown" ${costUnknown ? 'shown' : 'not shown'}`)
  if (m === 'http401') {
    await p.screenshot({ path: `${out}/1280-key-rejected.png` })
    await mode('propose'); await card(p).getByRole('button', { name: 'Retry' }).click()
    log(await waitText(p, 'From your notes'), '   Retry runs again and shows the result')
  }
  await p.close()
}

// Done while drafting: the result is kept, the card doesn't reopen.
reset(); await mode('slow')
p = await open()
await card(p).getByRole('button', { name: 'Draft my day' }).click(); await p.waitForTimeout(800)
await card(p).getByRole('button', { name: 'Done' }).click(); await p.waitForTimeout(23000)
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800)
log(!(await card(p).count()) && sql("SELECT draft FROM pages WHERE snapshot='current' AND draft LIKE '%\"ready\"%'").length === 1, 'Done while drafting: result kept, card not reopened')
await p.close()

// A call that never answers: the 60 s call timeout ends it before the 90 s expiry → "Model unavailable" + Retry.
// (Expiry itself, after a server restart mid-run, is checked separately: restart-check.sh.)
reset(); await mode('hang')
p = await open()
await card(p).getByRole('button', { name: 'Draft my day' }).click()
log(await waitText(p, 'Drafting your day', 3000), 'no answer: drafting…')
log(await waitText(p, 'Model unavailable · nothing was added', 110000), '   then "Model unavailable · nothing was added"')
log(await card(p).getByRole('button', { name: 'Retry' }).count() === 1 && sql("SELECT draft FROM pages WHERE snapshot='current' AND draft LIKE '%\"failed\"%'").length === 1, '   with Retry, stored as failed')
await p.screenshot({ path: `${out}/1280-no-answer.png` })
await p.close()

// 390: the drafted card.
reset(); await mode('propose')
p = await open(390)
await card(p).getByRole('button', { name: 'Draft my day' }).click()
log(await waitText(p, 'From your notes'), '390: drafted card')
await p.screenshot({ path: `${out}/390-drafted.png`, fullPage: true })
const add = await card(p).locator('.mc-add.dashed').first().boundingBox()
log(add && add.height >= 44, '390: the dashed + is a 44 px target', `${add?.height}`)
await card(p).locator('.mc-row', { hasText: '明天给 Kevin 回电话' }).getByRole('button', { name: /More for/ }).click()
await p.getByRole('menuitem', { name: 'Hide for today' }).click(); await p.waitForTimeout(800)
log(await waitText(p, '2 lines from', 3000), '390: Hide for today → the line is back under "2 lines from Mon"')
await p.close()
await b.close()
log(errors.length === 0, 'no page or console errors', errors.join(' | '))
