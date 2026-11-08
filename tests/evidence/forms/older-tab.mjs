// An older build (the floor) on a store with a form (forms.md §6, G7-8): it draws the form's view as a table, and a change it makes there keeps the form.
// Usage: node tests/evidence/forms/older-tab.mjs <older-build-url> <store-path>  (the older build's server reading the store this build seeded)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/forms/older-tab.mjs <older-build-url> <store-path>'); process.exit(2) }
const view = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()).pages.find(p => p.id === 'runs').database.views.find(v => v.id === 'f')
const wait = ms => new Promise(r => setTimeout(r, ms))
const b = await pw.chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
const errors = []; p.on('pageerror', e => errors.push(e.message))
const before = JSON.stringify({ layout: view().layout, form: view().form })
await p.goto(`${base}/pages?page=runs`); await wait(2200)
await p.getByRole('button', { name: /^Table/ }).first().click(); await wait(300); await p.locator('.database-menu').getByText('Log a run', { exact: true }).first().click({ timeout: 5000 }); await wait(800)
const table = await p.locator('.database-table th, [role=columnheader]').count()
// A change the older build makes to that view: a new property, from + at the end of its columns, which every view takes (the floor's + makes it at once).
await p.locator('.database-table th button, [role=columnheader] button').filter({ hasText: /^\+$/ }).last().click({ timeout: 5000 }).catch(e => errors.push(`add: ${e.message.split('\n')[0]}`)); await wait(400)
await wait(1500)
const after = view()
const added = JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()).pages.find(p => p.id === 'runs').database.properties.length === 7
const ok = table > 0 && added && after.layout === 'form' && JSON.stringify({ layout: after.layout, form: after.form }) === before && !errors.length
const properties = JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()).pages.find(p => p.id === 'runs').database.properties.length
console.log(ok ? 'PASS' : 'FAIL', 'the older build draws the form as a table and keeps it through its own change', JSON.stringify({ table, properties, columns: after.columns.length, layout: after.layout, kept: JSON.stringify(after.form) === JSON.stringify(JSON.parse(before).form), errors }).slice(0, 400))
await p.screenshot({ path: '/tmp/rb-csv/forms-older-tab.png' })
await b.close(); process.exit(ok ? 0 : 1)
