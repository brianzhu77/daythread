// Rollback check: a browser with #27's caching worker, then the kill build served at the same address.
// Run from any checkout with Playwright; needs /tmp/rb-serve2.sh-style restarts of the two builds on port 3572:
// the #27 build (fix/offline-copy-account) first, then this one, both on the same SQLite copy.
import { chromium } from '/Users/dogrod/Developer/daythread-offline-copy/node_modules/@playwright/test/index.mjs'
import { execSync } from 'node:child_process'
const base = 'http://127.0.0.1:3572', serve = (dir, db) => execSync(`/tmp/rb-serve2.sh ${dir} 3572 ${db}`, { stdio: 'inherit' })
serve('/Users/dogrod/Developer/daythread-offline-copy', '/tmp/rb-kill/w.sqlite')
const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const a = await context.newPage()
const dialogs = []; a.on('dialog', d => { dialogs.push(d.type()); d.accept() })
await a.goto(base + '/'); await a.locator('.bn-editor').first().waitFor()
await a.waitForFunction(() => !!navigator.serviceWorker.controller); await a.waitForTimeout(1000)
const state = p => p.evaluate(async () => ({ controller: navigator.serviceWorker.controller?.scriptURL ?? null, registrations: (await navigator.serviceWorker.getRegistrations()).length, caches: await caches.keys(), build: [...document.scripts].map(s => s.src).find(s => s.includes('/assets/'))?.split('/').pop() }))
console.log('before', JSON.stringify(await state(a)))
// Typing that hasn't saved: saves hang, as if the reply never came.
await a.route('**/_serverFn/**', route => route.request().method() === 'POST' ? undefined : route.continue())
await a.locator('.bn-editor [data-content-type="bulletListItem"] .bn-inline-content').last().click()
await a.keyboard.press('Meta+ArrowRight'); await a.keyboard.press('Enter'); await a.keyboard.type('Rollback typing check', { delay: 20 })
await a.waitForTimeout(800)
// The rollback: the kill build at the same address.
serve('/tmp/rb-rollback', '/tmp/rb-kill/w.sqlite')
await a.unroute('**/_serverFn/**')
// His next ordinary open: a new window on the app.
const nav = a.waitForEvent('framenavigated', { timeout: 20000 }).then(() => 'reloaded').catch(() => 'no reload')
const b = await context.newPage(); await b.goto(base + '/'); await b.locator('.bn-editor').first().waitFor()
console.log('open window', await nav, 'dialogs', JSON.stringify(dialogs))
await a.locator('.bn-editor').first().waitFor({ timeout: 20000 }); await a.waitForTimeout(2000)
console.log('after (typing tab)', JSON.stringify(await state(a)))
console.log('after (new open)', JSON.stringify(await state(b)))
console.log('typed line kept:', (await a.locator('.bn-editor').first().innerText()).includes('Rollback typing check'))
await browser.close()
