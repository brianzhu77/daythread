// Forms' second step in the built app (forms.md §3, G7-6): a question asked only after an answer above it, what a move costs, and Files answers.
// Usage: node tests/evidence/forms/forms-2.mjs <base-url> <store-path> <files-folder> [chromium|webkit]  (a throwaway store and files folder the server uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const [base, S, folder, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S || !folder) { console.error('Usage: node tests/evidence/forms/forms-2.mjs <base-url> <store-path> <files-folder> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const form = () => store().pages.find(p => p.id === 'runs').database.views.find(v => v.id === 'f').form
const rows = () => store().pages.filter(p => p.parentId === 'runs' && !p.trashedAt)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const photo = `${folder}/../route.jpg`; writeFileSync(photo, Buffer.alloc(2048, 7))
let failed = 0
const scenario = async (name, act, path = '/pages?page=runs') => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/forms/seed.ts ${S} files`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}${path}`); await wait(2200); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 4).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 700))
  await context.close()
}
const showForm = async page => { await page.getByRole('button', { name: /^Table/ }).first().click(); await wait(300); await page.locator('.database-menu').getByText('Log a run', { exact: true }).first().click(); await wait(800) }
const notices = page => page.locator('[role=alert], [role=status]').allTextContents().then(t => t.join(' | ').replace(/\s+/g, ' '))

await scenario('Ask only if: set on the form, the follow-up shows on its answer and goes on another, and a hidden answer isn\'t sent', async page => {
  await showForm(page)
  await page.getByRole('button', { name: 'Edit Note' }).click(); await wait(200)
  await page.getByLabel('Ask only if').selectOption('feel'); await wait(800)
  await page.getByRole('group', { name: 'Felt is' }).getByLabel('Hard').check(); await wait(900)
  const kept = form().questions.find(q => q.propertyId === 'note').showIf
  await page.getByRole('button', { name: 'Done' }).click(); await wait(300)
  const line = await page.locator('.form-condition').first().textContent()
  await page.goto(`${base}/form?db=runs&view=f`); await wait(2000)
  const before = await page.getByLabel('Note').count()
  await page.getByText('Hard', { exact: true }).click(); await wait(150)
  const shown = await page.getByLabel('Note').count()
  await page.getByLabel('Note').fill('typed, then hidden')
  await page.getByText('Good', { exact: true }).click(); await wait(150)
  const hidden = await page.getByLabel('Note').count()
  await page.getByLabel('Name').fill('Easy'); await page.getByLabel('How far did you go?').fill('2')
  await page.getByRole('button', { name: 'Send' }).click(); await wait(1500)
  const row = rows().find(r => r.title === 'Easy')
  return { ok: kept?.propertyId === 'feel' && kept.values.join() === 'hard' && line === 'Only if Felt is Hard' && before === 0 && shown === 1 && hidden === 0 && row && row.values.note === undefined && row.values.feel === 'good', kept, line, before, shown, hidden, values: row?.values }
})

await scenario('Moving the question a follow-up depends on below it says it\'s now always asked, with Undo', async page => {
  await showForm(page)
  await page.getByRole('button', { name: 'Edit Note' }).click(); await wait(200)
  await page.getByLabel('Ask only if').selectOption('feel'); await wait(600)
  await page.getByRole('group', { name: 'Felt is' }).getByLabel('Hard').check(); await wait(900)
  await page.getByRole('button', { name: 'Done' }).click(); await wait(200)
  await page.getByRole('button', { name: 'Edit Felt' }).click(); await wait(200)
  // Down until Felt is below Note, which is the move that costs the condition; another edit after it would retire its notice.
  const below = () => { const ids = form().questions.map(q => q.propertyId); return ids.indexOf('feel') > ids.indexOf('note') }
  for (let i = 0; i < 8 && !below(); i++) { await page.getByRole('button', { name: 'Move down' }).click(); await wait(700) }
  const said = await notices(page), dropped = form().questions.find(q => q.propertyId === 'note').showIf === undefined
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1200)
  const back = form().questions.find(q => q.propertyId === 'note').showIf
  return { ok: /Note is now always asked/.test(said) && dropped && back?.propertyId === 'feel', said: said.slice(0, 200), dropped, back, order: form().questions.map(q => q.propertyId), note: form().questions.find(q => q.propertyId === 'note').showIf }
})

await scenario('Files: a photo uploads and goes into the row; one that can\'t says so, holds nothing back, and can be taken off', async page => {
  await page.goto(`${base}/form?db=runs&view=f`); await wait(2000)
  await page.getByLabel('Name').fill('With a photo'); await page.getByLabel('How far did you go?').fill('3')
  await page.locator('[data-question="pics"] input[type=file]').setInputFiles(photo); await wait(1500)
  const uploaded = await page.locator('[data-question="pics"] .form-file a').allTextContents()
  // The next one fails: offline at the store.
  await page.route('**/api/files/**', route => (route.request().method() === 'PUT' ? route.abort() : route.continue()))
  await page.locator('[data-question="pics"] input[type=file]').setInputFiles(photo); await wait(1200)
  const failedText = await page.locator('[data-question="pics"] .form-file.is-failed').textContent()
  const sendOn = await page.getByRole('button', { name: 'Send' }).isEnabled()
  await page.getByRole('button', { name: /^Remove route.jpg/ }).last().click(); await wait(150)
  await page.getByRole('button', { name: 'Send' }).click(); await wait(1500)
  const row = rows().find(r => r.title === 'With a photo')
  return { ok: uploaded.join() === 'route.jpg' && /Not uploaded · Try again/.test(failedText) && sendOn && row?.values?.pics?.length === 1 && row.values.pics[0].name === 'route.jpg', uploaded, failedText, sendOn, pics: row?.values?.pics }
})
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
