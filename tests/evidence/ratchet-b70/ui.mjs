import assert from 'node:assert/strict'
import { chromium, webkit } from '@playwright/test'
const base = 'http://127.0.0.1:3668'
const tpl = '8f5f0f4e-70df-4370-97d0-5006dc4518d3'
const out = new URL('./results/', import.meta.url).pathname
for (const [name, engine, width] of [
  ['chromium', chromium, 1280],
  ['webkit', webkit, 390],
]) {
  const browser = await engine.launch()
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.goto(`${base}/pages?page=${tpl}`)
  await page.locator('.template-target').waitFor()
  await page.locator('.template-target').selectOption('')
  await page.waitForTimeout(500)
  assert.equal(await page.locator('.template-target').inputValue(), '')
  await page.locator('.template-target').selectOption('days')
  await page.waitForTimeout(500)
  const bullet = page.locator('[data-content-type="bulletListItem"] .bn-inline-content').last()
  await bullet.click()
  await page.keyboard.type(`Review ${name}`)
  await page.waitForTimeout(1000)
  await page.reload()
  await page.locator('.template-target').waitFor()
  assert.ok((await page.locator('.bn-editor').innerText()).includes(`Review ${name}`))
  console.log('PASS', name, 'template edit/reload and Default for None/Day pages')
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.screenshot({ path: `${out}/${name}-${scheme}.png`, fullPage: true })
  }
  if (name === 'chromium') {
    // Paste the same cut payload the app emits: authenticated token in same-origin storage.
    const token = 'review234-cut'
    const blocks = [
      {
        id: 'source-task',
        type: 'task',
        props: { taskId: 'editor-task:source-task', role: 'reference', planDate: '' },
        content: [{ type: 'text', text: 'Preserve real task', styles: {} }],
        children: [],
      },
    ]
    await bullet.click()
    await page.keyboard.press('Meta+ArrowRight')
    await page.waitForTimeout(180)
    await page.keyboard.press('Enter')
    await page.evaluate(
      ({ blocks, token }) => {
        localStorage.setItem(`daythread:cut:${token}`, JSON.stringify(blocks))
        const data = new DataTransfer()
        data.setData('application/x-daythread-blocks', JSON.stringify({ blocks, token, cut: true }))
        document.activeElement.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        )
      },
      { blocks, token },
    )
    await page.waitForTimeout(1200)
    console.log(
      'CUT CHECKBOX',
      await page
        .locator('input[type="checkbox"]')
        .evaluateAll((es) =>
          es.map((e) => ({ label: e.getAttribute('aria-label'), disabled: e.disabled })),
        ),
    )
    const live = page.getByRole('checkbox', { name: 'Complete Preserve real task', exact: true })
    if (await live.count()) {
      await live.click()
      await page.waitForTimeout(700)
      console.log('FINDING cut-pasted template row exposes live real-task checkbox')
      await page.screenshot({ path: `${out}/cut-real-checkbox.png`, fullPage: true })
    }
  }
  await browser.close()
}
