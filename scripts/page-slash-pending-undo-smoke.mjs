// Run against an isolated dev server with disposable SQLite only: it writes to today's page and creates a page.
// Ratchet #64: with the create reply held back for 1s, one ⌘Z right after "/page" takes the card out, the reply then
// opens nothing and brings back no card, and the page the server made stays (in Pages, as Untitled).
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:3063'
const browser = await chromium.launch({ headless: true }), errors = []
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('pageerror', e => errors.push(e.message))
await page.route('**/_serverFn/**', async route => {
  if (route.request().method() !== 'POST' || !(route.request().postData() ?? '').includes('create-document')) return route.continue()
  const response = await route.fetch(); await new Promise(r => setTimeout(r, 1000)); return route.fulfill({ response })
})
await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.locator('.bn-editor').waitFor()
const notes = page.locator('.bn-block-outer', { has: page.locator('h2', { hasText: 'Notes' }) })
await notes.locator('xpath=following-sibling::*[1]').locator('.bn-inline-content').first().click()
await page.keyboard.type('/page'); await page.waitForTimeout(300); await page.keyboard.press('Enter')
await page.locator('.editor-page-card-spinner').waitFor(); await page.waitForTimeout(200)
await page.keyboard.press('ControlOrMeta+z'); await page.waitForTimeout(100)
assert.equal(await page.locator('.editor-page-card').count(), 0, 'one undo removes the waiting card')
await page.waitForTimeout(2000)
assert.equal(await page.locator('.editor-page-card').count(), 0, 'the late reply brings no card back')
assert.equal(new URL(page.url()).pathname, '/', 'the late reply opens nothing')
await page.goto(base + '/pages', { waitUntil: 'networkidle' })
assert.ok((await page.locator('.card-list .card-row').allInnerTexts()).includes('Untitled'), 'the page the server made stays in Pages')
assert.deepEqual(errors, [])
await browser.close()
console.log('page-slash pending undo: ok')
