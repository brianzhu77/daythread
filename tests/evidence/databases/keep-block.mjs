// R1 part 1: a page holding a database block opens and saves with the block kept (on a build without the block spec,
// the editor fails with "Error creating document from blocks passed as initialContent").
// Usage: node tests/evidence/databases/keep-block.mjs <base-url> <store-path> [chromium|webkit]  (the store is a throwaway SQLite file the dev server at <base-url> uses; both are required)
import * as pw from '@playwright/test'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/keep-block.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto(`${base}/pages?page=books`)
await page.waitForTimeout(2500)
const label = await page.locator('.editor-database-label').allTextContents()
console.log('label', JSON.stringify(label))
await page.getByText('After the table').click()
await page.keyboard.press('Meta+ArrowRight')
await page.keyboard.type(' typed')
await page.waitForTimeout(2500)
console.log('errors', JSON.stringify(errors))
await browser.close()
if (errors.length || label.join('') !== 'Reading list') { console.error('FAIL'); process.exit(1) } else console.log('PASS (check the stored document still holds the block: it does on this build)')
