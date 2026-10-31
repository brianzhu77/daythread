import assert from 'node:assert/strict'
import { chromium, webkit } from '@playwright/test'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { flat } from '../../v2-helpers.ts'
import { pageNodes } from '../../../src/domain/editor-document.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
const base = 'http://127.0.0.1:3667',
  r = new SqliteWorkspaceRepository('/tmp/ratchet230-ui.sqlite'),
  out = '/tmp/ratchet230-ui'
mkdirSync(out, { recursive: true })
let results = []
async function check(name, fn) {
  try {
    await fn()
    results.push({ name, pass: true })
    console.log('PASS', name)
  } catch (e) {
    results.push({ name, pass: false, error: e.message })
    console.log('FAIL', name, e.message)
  }
}
for (const [engine, width] of [
  [chromium, 1280],
  [webkit, 390],
]) {
  const b = await engine.launch(),
    p = await b.newPage({ viewport: { width, height: 900 } })
  await p.goto(base + '/')
  await p.locator('.start-the-day').waitFor()
  await check(
    `${engine.name()} ${width}: morning offers only named task; no blank count or unfinished hint`,
    async () => {
      assert.equal(await p.locator('.start-the-day .mc-row').count(), 1)
      assert.ok((await p.locator('.start-the-day').innerText()).includes('Named yesterday'))
      assert.equal(await p.locator('.tomorrow-hint').count(), 0)
      assert.ok(!(await p.locator('body').innerText()).includes('other open task'))
    },
  )
  await p.screenshot({ path: out + '/' + width + '-morning.png' })
  await p.goto(base + '/tasks?view=open')
  await p.locator('.list-screen').waitFor()
  await check(`${engine.name()} ${width}: Tasks Open has one named row`, async () => {
    assert.equal(await p.locator('.list-screen .task-row').count(), 1)
    assert.ok((await p.locator('.list-screen').innerText()).includes('Named yesterday'))
  })
  await p.goto(base + '/day/2026-10-29')
  await p.locator('h2', { hasText: 'TODO' }).click()
  await p.locator('[data-id=b69-blank] .bn-inline-content').first().waitFor()
  await check(
    `${engine.name()} ${width}: original blank and whitespace checkbox lines remain`,
    async () => {
      for (const id of ['b69-blank', 'b69-spaces']) {
        assert.equal(await p.locator(`[data-id=${id}] input[type=checkbox]`).count(), 1)
        assert.equal(
          (await p.locator(`[data-id=${id}] .bn-inline-content`).first().innerText()).trim(),
          '',
        )
      }
    },
  )
  await p.screenshot({ path: out + '/' + width + '-blank-lines.png' })
  await b.close()
}
const b = await chromium.launch(),
  p = await b.newPage()
try {
  await p.goto(base + '/')
  await p.getByRole('button', { name: 'Add Named yesterday to today', exact: true }).click()
  await p.waitForTimeout(1300)
  await check(
    'Morning Add carries named task only; blank source rows stay; Tomorrow count is one',
    async () => {
      const w = await r.load(),
        d = w.pages.find((p) => p.date === '2026-10-30')
      const rows = flat(pageNodes(d))
      assert.equal(rows.filter((n) => n.props?.taskId === 'editor-task:b69-named').length, 1)
      for (const id of ['b69-blank', 'b69-spaces'])
        assert.ok(!rows.some((n) => n.props?.taskId === 'editor-task:' + id))
      assert.ok((await p.locator('.tomorrow-hint').innerText()).includes('1 unfinished'))
      assert.ok(
        flat(pageNodes(w.pages.find((p) => p.date === '2026-10-29'))).some(
          (n) => n.id === 'b69-blank',
        ),
      )
    },
  )
  await p.goto(base + '/day/2026-10-29')
  await p.locator('h2', { hasText: 'TODO' }).click()
  const line = p.locator('[data-id=b69-blank] .bn-inline-content').first()
  await line.click()
  await p.keyboard.type('Call the plumber')
  await p.waitForTimeout(1400)
  await p.goto(base + '/tasks?view=open')
  await p.locator('.list-screen').waitFor()
  await check(
    'Typing into retained checkbox activates same identity and appears in Open',
    async () => {
      assert.equal(await p.locator('.list-screen .task-row').count(), 2)
      assert.ok((await p.locator('.list-screen').innerText()).includes('Call the plumber'))
      assert.equal(
        (await r.load()).tasks.find((t) => t.id === 'editor-task:b69-blank').title,
        'Call the plumber',
      )
    },
  )
  await p.goto(base + '/')
  await p.locator('.start-the-day').waitFor()
  await check('Newly named prior-day checkbox is now offered in morning card', async () =>
    assert.ok((await p.locator('.start-the-day').innerText()).includes('Call the plumber')),
  )
} finally {
  await b.close()
  writeFileSync(out + '/results.json', JSON.stringify(results, null, 2))
}
if (results.some((x) => !x.pass)) process.exitCode = 1
