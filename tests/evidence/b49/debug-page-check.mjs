import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
const require = createRequire(import.meta.url)
const { webkit, devices } = require('@playwright/test')
const [base, DB] = process.argv.slice(2)
const rev = () => { const d = new DatabaseSync(DB, { readOnly: true }); try { return d.prepare("SELECT revision FROM meta WHERE snapshot='current'").get()?.revision } finally { d.close() } }
const b = await webkit.launch(), ctx = await b.newContext({ ...devices['iPhone 13'] }), p = await ctx.newPage()
const serverFns = []; p.on('request', r => { if (r.url().includes('/_serverFn/')) serverFns.push(r.method() + ' ' + r.url().slice(0, 90)) })
const errors = []; p.on('pageerror', e => errors.push(e.message))
await p.goto(base, { waitUntil: "networkidle" }); await p.waitForTimeout(800); serverFns.length = 0
const before = rev()
await p.goto(`${base}/debug-ime`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const notes = p.locator(`.bn-block-outer[data-id="day:${today}:notes:template:0"] .bn-inline-content`).first()
await notes.tap(); await p.keyboard.type('hello'); await p.keyboard.press('Enter'); await p.keyboard.type('world'); await p.waitForTimeout(1500)
const log = await p.evaluate(() => window.__b49log.length)
const lines = await p.evaluate(() => [...document.querySelectorAll('.bn-editor .bn-inline-content')].map(e => e.textContent).filter(Boolean))
const slots = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daythread:editor:')))
await p.goto('about:blank'); 
console.log(JSON.stringify({ shell: 'standalone', lines: lines.slice(-3), recorderEvents: log, slotsWhileOpen: slots, serverFns, revisionBefore: before, revisionAfter: rev(), errors }))
await b.close()
