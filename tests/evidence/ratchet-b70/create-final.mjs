import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { chromium, webkit } from '@playwright/test'
import { createEmptyWorkspace } from '../../../src/domain/workspace.ts'
const path = '/tmp/ratchet234-final-empty.sqlite'
function resetFixture() {
  const db = new DatabaseSync(path)
  db.prepare('update workspace set revision = 0, data = ? where id = 1').run(
    JSON.stringify(createEmptyWorkspace()),
  )
  db.close()
}
function templates() {
  const db = new DatabaseSync(path, { readOnly: true })
  const ws = JSON.parse(db.prepare('select data from workspace').get().data)
  db.close()
  return ws.pages.filter((p) => p.type === 'template')
}
for (const [name, engine, width] of [
  ['chromium', chromium, 1280],
  ['webkit', webkit, 390],
]) {
  // Initialise the empty file before resetting; this port is only this script's invented fixture.
  const browser = await engine.launch()
  let page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
  await page.goto('http://127.0.0.1:3669/pages?view=templates')
  await page.getByRole('heading', { name: 'Templates', exact: true }).waitFor()
  await page.close()
  resetFixture()
  page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
  await page.goto('http://127.0.0.1:3669/pages?view=templates')
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() === 'POST')
      await new Promise((resolve) => setTimeout(resolve, 600))
    await route.continue()
  })
  const edit = page.getByRole('button', { name: 'Edit', exact: true })
  await edit.dblclick({ delay: 80 })
  await page.locator('.template-target').waitFor()
  assert.equal(templates().length, 1)
  await page.locator('.template-target').selectOption('')
  await page.waitForTimeout(600)
  await page.getByRole('link', { name: 'Templates', exact: true }).click()
  await page.getByRole('heading', { name: 'Templates', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Edit', exact: true }).count(), 0)
  assert.equal(await page.locator('.card-row-title').count(), 1)
  console.log(
    'PASS',
    name,
    'delayed double Edit makes one; None + crumb returns to one row without Edit',
  )
  await page.close()
  resetFixture()
  page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
  await page.goto('http://127.0.0.1:3669/pages?view=templates')
  await page.getByRole('button', { name: 'Edit', exact: true }).waitFor()
  console.log('Retry fixture ready', name, templates().length)
  const posts = []
  let failed = false
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postData())
      if (!failed) {
        failed = true
        return route.fulfill({
          status: 503,
          contentType: 'text/plain',
          body: 'Temporary test failure',
        })
      }
    }
    await route.continue()
  })
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.waitForTimeout(1200)
  console.log(
    'After failed request',
    name,
    JSON.stringify({
      templates: templates().length,
      body: await page.locator('body').innerText(),
      posts: posts.length,
    }),
  )
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.locator('.template-target').waitFor()
  const ids = posts.map((body) =>
    body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)?.at(-1),
  )
  assert.ok(ids[0] && ids[0] === ids[1], JSON.stringify(posts))
  assert.equal(templates().length, 1)
  console.log('PASS', name, 'failed create + Edit retries same pageId once')
  await browser.close()
}
