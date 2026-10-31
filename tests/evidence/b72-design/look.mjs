import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2] ?? 'http://127.0.0.1:3598', SLOW = 1000, out = process.argv[3] ?? '/tmp/jazz-b72'
for (const [name, br, width, height] of [['webkit', webkit, 390, 844], ['chromium', chromium, 1280, 900]]) for (const scheme of ['light', 'dark']) {
  const touch = width === 390
  const b = await br.launch()
  const ctx = await b.newContext({ serviceWorkers: 'block', colorScheme: scheme, viewport: { width, height }, ...(touch ? { isMobile: true, hasTouch: true } : {}) })
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('pageerror', e.message))
  await p.route('**/_serverFn/**', async r => { if (r.request().method() === 'POST') await new Promise(s => setTimeout(s, SLOW)); return r.continue() })
  const tag = `${name}-${width}-${scheme}`
  // Day page: pending vs saved look of the same row.
  await p.goto(`${base}/`); await p.waitForSelector('.editor-task[data-status=open] input'); await p.waitForLoadState('networkidle')
  const id = await p.locator('.editor-task[data-status=open]').first().evaluate(el => el.closest('[data-id]').dataset.id)
  const row = p.locator(`[data-id="${id}"]`).first(), box = row.locator('.editor-task input').first()
  await p.mouse.move(0, 0)
  await row.screenshot({ path: `${out}/${tag}-day-0open.png` })
  touch ? await box.tap() : await box.click(); await p.mouse.move(0, 0); await p.waitForTimeout(150)
  const pend = await row.screenshot({ path: `${out}/${tag}-day-1pending.png` })
  await p.waitForTimeout(SLOW + 1300)
  const saved = await row.screenshot({ path: `${out}/${tag}-day-2saved.png` })
  console.log(tag, 'day: pending == saved pixels:', Buffer.compare(pend, saved) === 0)
  touch ? await box.tap() : await box.click(); await p.waitForTimeout(SLOW + 1300) // restore
  // Tasks screen: pending, holding, gone.
  await p.goto(`${base}/tasks?view=today`); await p.waitForSelector('.task-row.list input.check'); await p.waitForLoadState('networkidle')
  const list = p.locator('.task-row.list').first().locator('xpath=..')
  const firstRow = p.locator('.task-row.list').first(), tid = await firstRow.getAttribute('data-task-id')
  await list.screenshot({ path: `${out}/${tag}-tasks-0open.png` })
  const c = firstRow.locator('input.check'); touch ? await c.tap() : await c.click(); await p.mouse.move(0, 0); await p.waitForTimeout(150)
  const tp = await firstRow.screenshot({ path: `${out}/${tag}-tasks-1pending.png` }); await list.screenshot({ path: `${out}/${tag}-tasks-1pending-list.png` })
  await p.waitForTimeout(SLOW + 200)
  const th = await firstRow.screenshot({ path: `${out}/${tag}-tasks-2holding.png` })
  console.log(tag, 'tasks: pending == holding pixels:', Buffer.compare(tp, th) === 0)
  await p.waitForTimeout(1500)
  console.log(tag, 'tasks: row gone after hold:', (await p.locator(`.task-row.list[data-task-id="${tid}"]`).count()) === 0)
  await list.screenshot({ path: `${out}/${tag}-tasks-3after.png` })
  // Restore: reopen from the Done notice's Undo if present, else leave.
  const undo = p.getByRole('button', { name: 'Undo' }).first(); if (await undo.isVisible().catch(() => false)) { await undo.click(); await p.waitForTimeout(SLOW + 500) }
  await b.close()
}
