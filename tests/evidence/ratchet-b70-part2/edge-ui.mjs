import assert from 'node:assert/strict'
import { chromium, webkit } from '@playwright/test'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { DatabaseSync } from 'node:sqlite'
const repo = new SqliteWorkspaceRepository('/tmp/ratchet236.sqlite')
const base = 'http://127.0.0.1:3670'
for (const [name, engine, width] of [
  ['chromium', chromium, 1280],
  ['webkit', webkit, 390],
]) {
  const b = await engine.launch()
  const p = await b.newPage({ viewport: { width, height: 900 }, colorScheme: 'dark' })
  await p.goto(base + '/pages?page=specific-tpl')
  await p.locator('.template-target').waitFor()
  assert.equal(await p.locator('.template-target').inputValue(), 'long-parent')
  const label = await p.locator('.template-target option:checked').innerText()
  assert.ok(label.startsWith('Pages in Nested notes › Korean soup'))
  assert.ok(await p.locator('.template-target option[value="nested"]').count())
  const geometry = await p.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    right: document.querySelector('.template-target').getBoundingClientRect().right,
    width: innerWidth,
  }))
  assert.ok(!geometry.overflow && geometry.right <= geometry.width)
  console.log('PASS long nested option fits', name, width, JSON.stringify(geometry), label)
  await p.screenshot({
    path: new URL(`./results/long-target-${name}.png`, import.meta.url).pathname,
    fullPage: true,
  })
  await b.close()
}
await repo.executeOnLatest(crypto.randomUUID(), {
  type: 'delete-page',
  pageId: 'long-parent',
  at: '2026-10-31T05:41:00Z',
})
const b = await webkit.launch(),
  p = await b.newPage({ viewport: { width: 390, height: 900 } })
await p.goto(base + '/pages?page=specific-tpl')
await p.locator('.template-target').waitFor()
assert.ok((await p.locator('.template-target option:checked').innerText()).includes('in Trash'))
console.log('PASS trashed target named in menu; template stays live')
await p.close()
// Force an otherwise unreachable missing-target state on this invented SQLite copy only.
const db = new DatabaseSync('/tmp/ratchet236.sqlite')
const w = JSON.parse(db.prepare('select data from workspace').get().data)
w.pages = w.pages.filter((x) => x.id !== 'long-parent')
w.revision++
db.prepare('update workspace set revision=?,data=? where id=1').run(w.revision, JSON.stringify(w))
db.close()
const q = await b.newPage({ viewport: { width: 390, height: 900 } })
await q.goto(base + '/pages?page=specific-tpl')
await q.locator('.template-target').waitFor()
assert.equal(await q.locator('.template-target').inputValue(), '')
await q.locator('.template-target').selectOption('top-level')
await q.waitForTimeout(500)
assert.equal((await repo.load()).pages.find((x) => x.id === 'specific-tpl').parentId, 'top-level')
console.log(
  'PASS forced missing target reads None, can assign a new default; stale id does not block',
)
await b.close()
