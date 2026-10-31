import { chromium } from '@playwright/test'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
const repo = new SqliteWorkspaceRepository('/tmp/ratchet236.sqlite')
const browser = await chromium.launch()
const page = await browser.newPage({ serviceWorkers: 'block' })
await page.goto('http://127.0.0.1:3670/pages?page=specific-tpl')
await page.locator('.template-target').waitFor()
let refused = 0
await page.route('**/_serverFn/**', (route) => {
  if (route.request().method() === 'POST' && route.request().postData()?.includes('save-editor')) {
    refused++
    return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Test save unavailable' })
  }
  return route.continue()
})
await page.locator('[data-content-type="bulletListItem"] .bn-inline-content').first().click()
await page.keyboard.type(' Failed save text')
await page.waitForTimeout(1000)
console.log('Save attempts refused', refused)
await page.getByRole('button', { name: 'Template actions', exact: true }).click()
await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
await page.waitForTimeout(700)
console.log(
  'Template exists despite save failure?',
  (await repo.load()).pages.some((p) => p.id === 'specific-tpl'),
)
console.log('Screen', await page.locator('body').innerText())
console.log(
  'Delete stopped on template page',
  new URL(page.url()).searchParams.get('page') === 'specific-tpl',
)
await browser.close()
