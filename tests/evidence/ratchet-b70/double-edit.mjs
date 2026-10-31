import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://127.0.0.1:3669/pages?view=templates')
const edit = page.getByRole('button', { name: 'Edit', exact: true })
await edit.waitFor()
await page.route('**/*', async (route) => {
  if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 600))
  await route.continue()
})
await edit.dblclick({ delay: 80 })
await page.waitForTimeout(2200)
await page.goto('http://127.0.0.1:3669/pages?view=templates')
await page.getByRole('heading', { name: 'Templates', exact: true }).waitFor()
console.log(
  'Day rows after double-click Edit:',
  await page.locator('.card-row-title').allInnerTexts(),
)
await page.screenshot({ path: new URL('./results/double-edit.png', import.meta.url).pathname })
await browser.close()
