// A table low on the screen: its `⋯` and "Table ⌄" menus stay on screen at every panel, and their last items can be clicked.
// Fresh store (reseeded), with lines added above the table. Found by the Worker gate: the panel ran off the bottom at 1280 x 800.
// Usage: node tests/evidence/databases/menu-on-screen.mjs <base-url> <store-path> [chromium|webkit]  (the store is a throwaway SQLite file the dev server at <base-url> uses; both are required)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/menu-on-screen.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const addLines = `const {SqliteWorkspaceRepository}=await import('./src/server/sqlite-repository.ts');const {pageContentKey}=await import('./src/domain/editor-document.ts');const r=new SqliteWorkspaceRepository('${storePath}',undefined,{allowMissingLegacy:true});const w=await r.load();const b=w.pages.find(p=>p.id==='books');const lines=Array.from({length:14},(_,i)=>({id:'x'+i,type:'paragraph',props:{},content:[{type:'text',text:'Line '+i,styles:{}}],children:[]}));await r.execute({operationId:'x',expectedRevision:w.revision,action:{type:'save-editor',pageId:'books',expectedContent:pageContentKey(b),document:JSON.stringify([...lines,...JSON.parse(b.document)])}})`
execSync(`node --input-type=module -e "${addLines}"`, { stdio: 'ignore' })
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500)
const out = {}
const menu = page.locator('.database-menu')
const fits = async name => { await page.waitForTimeout(200); const b = await menu.boundingBox(); out[name] = { top: Math.round(b.y), bottom: Math.round(b.y + b.height) }; return b.y >= 0 && b.y + b.height <= 800 }
let ok = true
await page.locator('.database-more-button').first().click()
ok = await fits('root') && ok
await menu.getByRole('menuitem', { name: 'Properties' }).click()
ok = await fits('properties') && ok
await menu.getByRole('menuitem', { name: '+ Add property' }).click({ timeout: 5000 })
ok = await fits('newProperty') && ok
await menu.getByRole('textbox', { name: 'Property name' }).fill('Last')
await menu.getByRole('menuitem', { name: 'URL' }).click({ timeout: 5000 })
ok = await fits('property') && ok
await page.keyboard.press('Escape'); await page.waitForTimeout(200)
await page.locator('.database-view-name').first().click()
ok = await fits('views') && ok
await page.keyboard.press('Escape')
const made = JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()).pages.find(p => p.id === 'list').database.properties.some(p => p.name === 'Last' && p.type === 'url')
console.log(JSON.stringify({ ...out, made, errors }))
ok = ok && made && !errors.length
console.log(ok ? 'PASS' : 'FAIL'); await browser.close(); if (!ok) process.exit(1)
