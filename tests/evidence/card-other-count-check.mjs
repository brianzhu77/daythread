// Lead 23a43f85: "N other open tasks" leaves out the open card's task rows; Later counts them again; adding one makes it
// planned for today, so it's out either way. Built app over a copy of Brian's database.
//   node tests/evidence/card-other-count-check.mjs <base url> <screenshot dir> <playwright index.mjs>
const [base, out, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const errors = []; const b = await chromium.launch()
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
const other = async p => (await p.locator('body').innerText()).split('\n').filter(l => /other open task/.test(l))
const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
log((await other(p)).length === 0 && await p.getByText('Unfinished · from Mon').isVisible(), 'card open with the Calendar row: no "other" line', JSON.stringify(await other(p)))
await p.screenshot({ path: `${out}/card-open.png` })
await p.getByRole('button', { name: 'Later' }).click(); await p.waitForTimeout(500)
log(JSON.stringify(await other(p)) === '["1 other open task"]', 'Later: "1 other open task"', JSON.stringify(await other(p)))
await p.screenshot({ path: `${out}/card-later.png` })
await p.getByText(/Suggestions · 1/).click(); await p.waitForTimeout(500)
await p.locator('.mc-add, button[aria-label^="Add"]').first().click(); await p.waitForTimeout(1500)
log((await other(p)).length === 0, 'after + on the row: no "other" line (planned for today)', JSON.stringify(await other(p)))
await p.screenshot({ path: `${out}/card-added.png` })
await b.close()
log(errors.length === 0, 'no page or console errors', errors.join(' | '))
