import { chromium } from '@playwright/test'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { pageNodes, inlineText } from '../../../src/domain/editor-document.ts'
const repo = new SqliteWorkspaceRepository('/tmp/ratchet236.sqlite')
const browser = await chromium.launch()
const page = await browser.newPage({ serviceWorkers: 'block' })
await page.goto('http://127.0.0.1:3670/pages?page=specific-tpl')
await page.locator('.template-target').waitFor()
const bullet = page.locator('[data-content-type="bulletListItem"] .bn-inline-content').first()
await bullet.click()
await page.keyboard.type('Latest words before delete')
await page.getByRole('button', { name: 'Template actions', exact: true }).click()
await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
await page.getByRole('button', { name: 'Undo', exact: true }).click()
await page.waitForTimeout(1000)
let ws = await repo.load()
console.log('UNDO RESTORED', JSON.stringify(ws.pages.find((p) => p.id === 'specific-tpl')))
console.log('BODY AFTER UNDO', await page.locator('body').innerText())
await page.goto('http://127.0.0.1:3670/pages?page=specific-tpl')
await page.locator('.template-target').waitFor()
await page.waitForTimeout(700)
ws = await repo.load()
console.log(
  'REOPEN RESTORED WORDS',
  pageNodes(ws.pages.find((p) => p.id === 'specific-tpl')).map((n) => inlineText(n.content)),
)
await browser.close()
