// B21 PR 1: a page holding a synced block opens, shows its lines on both pages, saves what's typed around it and keeps it, and the
// stored file holds the lines once. Usage: node tests/evidence/b21/record.mjs <base-url> <store-path> [chromium|webkit]
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/b21/record.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const raw = () => execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()
const store = () => JSON.parse(raw())
const wait = ms => new Promise(r => setTimeout(r, ms))
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/b21/seed.ts ${storePath}`, { stdio: 'ignore' })
const browser = await pw[engine].launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(), errors = []
page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
const texts = () => page.locator('.bn-inline-content').allInnerTexts()
await page.goto(`${base}/pages?page=a`); await wait(2200)
const onA = await texts()
await page.goto(`${base}/pages?page=b`); await wait(2200)
const onB = await texts()
await page.locator('.bn-inline-content', { hasText: 'Above on B' }).click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150); await page.keyboard.type(' typed'); await wait(2200)
const s = store(), a = s.pages.find(p => p.id === 'a'), b = s.pages.find(p => p.id === 'b')
const notices = (await page.locator('[role=alert], [role=status]').allInnerTexts()).join(' | ').replace(/\s+/g, ' ')
const r = { onA, onB, typed: b.document.includes('typed'), storedLinesInPages: [a, b].filter(p => p.document.includes('Shared')).length, inRecord: s.synced?.[0]?.lines.includes('Shared one'), notices, errors }
await page.goto(`${base}/pages?page=b`); await wait(2200)
r.afterReload = await texts()
const ok = onA.join().includes('Shared one') && onB.join().includes('Shared one') && r.typed && r.storedLinesInPages === 0 && r.inRecord && !/another|elsewhere/i.test(notices) && r.afterReload.join().includes('Shared two') && !errors.length
console.log(JSON.stringify(r)); console.log(ok ? 'PASS' : 'FAIL')
await browser.close(); if (!ok) process.exit(1)
