// Run on the local stub-backed store after notes-changed.mjs has made a real edit.
import * as pw from '@playwright/test'
const [base, engine = 'chromium', width = '1280'] = process.argv.slice(2)
const browser = await pw[engine].launch()
try {
  const page = await browser.newPage({viewport:{width:Number(width),height:900},serviceWorkers:'block'})
  await page.goto(base)
  const refresh = page.locator('.smart-note-refresh').first()
  await refresh.waitFor({timeout:20000})
  await refresh.click()
  await page.waitForTimeout(1000)
  await page.waitForFunction(() => !document.querySelector('.smart-note-refresh')?.disabled && !document.querySelector('.smart-note-changed'))
  await page.reload()
  await page.locator('.smart-note').first().waitFor({timeout:20000})
  await page.waitForTimeout(2500)
  if (await page.locator('.smart-note-changed').count()) throw Error('Changed after Refresh/reload')
  console.log(`PASS ${engine} ${width}: Refresh then reload stays unchanged`)
} finally { await browser.close() }
