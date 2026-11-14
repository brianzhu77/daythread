// Jazz's case (01ec668c), from her script: a new Whole-workspace smart note placed with `/` on today's day shows no
// "Notes changed" after Save or after a reload; typing a line on that day then shows it (#214).
// Usage: node tests/evidence/smart-note/notes-changed.mjs <base-url> [chromium|webkit] [1280|390]
//   The server runs sign-in off on a store with a day page and some writing (e.g. tests/evidence/place/seed.ts), with
//   OPENROUTER_BASE_URL=http://127.0.0.1:<port> (stub-model.mjs), OPENROUTER_API_KEY and OPENROUTER_MODEL set to anything.
import * as pw from '@playwright/test'
const [base, engine = 'chromium', width = '1280'] = process.argv.slice(2), wait = ms => new Promise(r => setTimeout(r, ms))
if (!base) { console.error('Usage: node tests/evidence/smart-note/notes-changed.mjs <base-url> [chromium|webkit] [1280|390]'); process.exit(2) }
const w = Number(width), phone = w < 900
const b = await pw[engine].launch(), p = await (await b.newContext({ viewport: { width: w, height: phone ? 844 : 900 }, hasTouch: phone, serviceWorkers: 'block' })).newPage()
const tap = l => (phone ? l.tap() : l.click())
const changed = () => p.locator('.smart-note-changed').count()
await p.goto(base + '/'); await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await wait(1200)
await tap(p.locator('.bn-block-content[data-content-type=bulletListItem]').last()); await wait(300)
await p.keyboard.type('/'); await wait(600)
await tap(p.locator('#bn-suggestion-menu [role=option]', { hasText: 'Smart note' })); await wait(800)
const dialog = p.getByRole('dialog', { name: 'Smart note' })
if (await dialog.getByRole('menuitem', { name: 'New smart note' }).count()) { await tap(dialog.getByRole('menuitem', { name: 'New smart note' })); await wait(500) }
await dialog.locator('#smart-note-prompt').fill('总结这一周')
await tap(dialog.getByRole('button', { name: 'Run preview' })); await dialog.locator('.smart-setup-preview li').first().waitFor({ timeout: 15000 })
await tap(dialog.locator('#smart-note-save')); await wait(2000)
const afterSave = await changed()
await p.reload(); await p.locator('.smart-note').first().waitFor({ timeout: 20000 }); await wait(2500)
const afterReload = await changed()
await tap(p.locator('.bn-block-content[data-content-type=task] .bn-inline-content').first()); await p.keyboard.type('Pack the charger'); await wait(2500)
const afterTyping = await changed()
const pass = afterSave === 0 && afterReload === 0 && afterTyping === 1
console.log(`${pass ? 'PASS' : 'FAIL'} ${engine} ${w}: "Notes changed" after Save ${afterSave}, after a reload ${afterReload}, after typing on the day ${afterTyping} (want 0, 0, 1)`)
await b.close()
process.exit(pass ? 0 : 1)
