// B81's other side: a real change elsewhere still says so, and typing after a save on its way isn't lost or doubled.
// Usage: node tests/evidence/b81/conflict.mjs <base-url> <store-path> <chromium|webkit>  (a throwaway SQLite file, reseeded; through slow-proxy.mjs for "typed more")
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (process.argv.length < 5) { console.error('Usage: node tests/evidence/b81/conflict.mjs <base-url> <store-path> <chromium|webkit>'); process.exit(2) }
const [base, storePath, engine] = process.argv.slice(2)
const seed = () => execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const doc = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()).pages.find(p => p.id === 'books').document
const browser = await pw[engine].launch({ headless: true })
const wait = ms => new Promise(r => setTimeout(r, ms))
const open = async () => { const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await context.newPage(); await page.goto(`${base}/pages?page=books`); await wait(2500); await page.getByText('After the table').click(); await page.keyboard.press('Meta+ArrowRight'); return { context, page } }
const line = page => page.locator('.editor-save-line').innerText().then(t => t.replace(/\s+/g, ' ')).catch(() => '')
let bad = 0
const report = (name, ok, out) => { if (!ok) bad++; console.log(ok ? 'ok  ' : 'FAIL', engine, name, JSON.stringify(out)) }

// Offline, typed; another device changes the page; back, reload: the notice shows, and both texts survive.
for (let run = 1; run <= 3; run++) {
  seed()
  const { context, page } = await open()
  await context.setOffline(true)
  await page.keyboard.type(' mine offline'); await wait(2000)
  execSync(`node --input-type=module -e "const {SqliteWorkspaceRepository}=await import('./src/server/sqlite-repository.ts');const {pageContentKey}=await import('./src/domain/editor-document.ts');const r=new SqliteWorkspaceRepository('${storePath}',undefined,{allowMissingLegacy:true});const w=await r.load();const p=w.pages.find(x=>x.id==='books');const d=JSON.parse(p.document);d.unshift({id:'elsewhere',type:'paragraph',props:{},content:[{type:'text',text:'from another device',styles:{}}],children:[]});await r.execute({operationId:'other-${run}',expectedRevision:w.revision,action:{type:'save-editor',pageId:'books',expectedContent:pageContentKey(p),document:JSON.stringify(d)}})"`, { stdio: 'ignore' })
  await context.setOffline(false)
  await page.reload().catch(() => {}); await wait(5000)
  const shown = await line(page), notice = /another device|another tab/i.test(shown)
  const stored = doc(), kept = stored.includes('from another device')
  // Load latest brings his line back below it.
  await page.getByRole('button', { name: 'Load latest' }).click({ timeout: 3000 }).catch(() => {}); await wait(2500)
  const mine = await page.getByText('mine offline').count()
  report('real conflict', notice && kept && mine === 1, { shown, kept, mine })
  await context.close()
}
// A save on its way, more typed, a reload: everything ends up saved, once.
for (const after of [460, 520, 600]) for (let run = 1; run <= 2; run++) {
  seed()
  const { context, page } = await open()
  await page.keyboard.type(' first'); await wait(after)
  await page.keyboard.type(' second')
  await page.reload().catch(() => {}); await wait(5000)
  const shown = await line(page), stored = doc()
  const first = (stored.match(/first/g) ?? []).length, second = (stored.match(/ second/g) ?? []).length
  report('typed more', first === 1 && second === 1 && !/another device|another tab|draft kept/i.test(shown), { after, shown, first, second })
  await context.close()
}
await browser.close()
console.log(bad ? `FAIL ${bad}` : 'PASS')
if (bad) process.exit(1)
