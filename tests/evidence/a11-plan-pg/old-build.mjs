// Runs against the CURRENT build (the rollback build) serving the throwaway schema; reports what it does with A11 data.
import { chromium } from '@playwright/test'
import postgres from 'postgres'
const [base, url, schema] = process.argv.slice(2)
const sql = postgres(url, { prepare: false, onnotice: () => {} })
const row = async () => (await sql.unsafe(`select revision, data::text as data from ${schema}.workspace`))[0]
const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1280, height: 1000 } }), errors = []
p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await p.goto(base + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
const shown = await p.locator('.continuous-editor .bn-inline-content').allInnerTexts()
console.log('renders as:', JSON.stringify(shown.filter(t => /link:/.test(t))))
const before = await row()
// An edit elsewhere on the page, so the old build saves it.
const t = await p.locator('.continuous-editor .bn-inline-content', { hasText: 'a task he links to' }).first().boundingBox()
await p.mouse.click(t.x + t.width - 2, t.y + t.height / 2); await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.type(' x'); await p.waitForTimeout(2500)
const after = await row(), d = JSON.parse(after.data), day = d.pages.find(x => x.type === 'daily')
const ej = day.editorJSON
console.log(JSON.stringify({
  revisions: `${before.revision} → ${after.revision}`,
  lineIdAfterOldSave: (ej.match(/"lineId"/g) ?? []).length, taskIdPropAfterOldSave: ej.includes('"taskId":"editor-task'), linksStillThere: (ej.match(/"pageRef"/g) ?? []).length,
  doneOnKept: d.tasks.some(t => 'doneOn' in t), seenProbeKept: !!day.editorBlockMetadata?.['a11-probe'], errors,
}))
await b.close(); await sql.end()
