// Nested filter groups in the built app (filter-groups.md), on a fresh store from board/seed-board.ts: the sheet's layers, the rows, one chip,
// a reload, + New walking the tree, moving rules in and out, the last rule taking its group, and 390 with three layers.
// Usage: node tests/evidence/filter-groups/filter-groups.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/filter-groups/filter-groups.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const tap = l => wide ? l.click() : l.tap()
const block = page.locator('.database-block').first(), menu = page.locator('.database-menu')
const view = () => store().pages.find(p => p.id === 'list').database.views[0]
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(250); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ force: true }).catch(() => {}); await wait(250) } }
const shown = async () => new Set(await block.locator('tr.database-row').evaluateAll(l => l.map(e => e.dataset.row)))
const openFilter = async () => { await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Filter' })); await wait(200) }
const chips = () => block.locator('.database-filter-line .database-filter-chip').allInnerTexts()
const sameRows = (a, ...want) => a.size === want.length && want.every(w => a.has(w))
const addTo = (l, name) => tap(l.getByRole('menuitem', { name, exact: true }).last())
const inGroup = n => menu.getByRole('group', { name: 'Filter group' }).nth(n)
const setPagesOver = async (l, n) => { await l.getByLabel('Property').last().selectOption({ label: 'Pages' }); await wait(500); await l.getByLabel('Condition').last().selectOption('gt'); await wait(400); await l.getByLabel('Value').last().fill(String(n)); await page.keyboard.press('Enter'); await wait(800) }

await page.goto(`${base}/pages?page=books`); await wait(2500)
const all = await shown()
await openFilter()
check(await menu.getByRole('group', { name: 'Filter group' }).count() === 0 && await menu.getByRole('menuitem', { name: '+ Add group' }).count() === 1, 'an empty sheet offers a rule or a group')
await addTo(menu, '+ Add filter'); await wait(700)
await menu.getByLabel('Property').last().selectOption({ label: 'Kind' }); await wait(600)
await menu.getByLabel('Novel').last().click({ force: !wide }); await wait(800)
// A group, with a rule ready in it.
await addTo(menu, '+ Add group'); await wait(800)
check(view().filterGroups?.length === 1 && view().filterGroups[0].rules.length === 1, 'a group starts with a rule', view().filterGroups)
check(sameRows(await shown(), 'dune', 'emma') || (await shown()).size > 0, 'an unfinished rule in it hides nothing more')
const beforeRule = await shown()
await setPagesOver(inGroup(0), 350)
const narrowed = await shown()
check(narrowed.has('dune') && !narrowed.has('emma') && !narrowed.has('ubik'), 'the rule and the group both hold', [...narrowed])
await addTo(inGroup(0), '+ Add filter'); await wait(700)
await inGroup(0).getByLabel('Property').last().selectOption({ label: 'Tags' }); await wait(600)
await inGroup(0).getByLabel('History').last().click({ force: !wide }); await wait(800)
await inGroup(0).getByLabel('Rows where').selectOption('any'); await wait(800)
const eitherRows = await shown()
check(view().filterGroups[0].any === true && eitherRows.has('dune') && eitherRows.has('emma') && !eitherRows.has('ubik'), 'any in the group, all above it', [...eitherRows])
await shot('two-layers')
// A third layer, and no fourth.
await addTo(inGroup(0), '+ Add group'); await wait(800)
check(view().filterGroups[0].groups?.length === 1, 'a group inside the group')
check(await inGroup(1).getByRole('menuitem', { name: '+ Add group' }).count() === 0, 'the third layer offers no fourth')
await tap(inGroup(1).getByRole('button', { name: 'Move rule' }).last()); await wait(250)
check(await inGroup(1).getByRole('menuitem', { name: 'Move into a new group' }).count() === 0 && await inGroup(1).getByRole('menuitem', { name: 'Move out of this group' }).count() === 1, 'its rule can only move out')
await page.keyboard.press('Escape'); await wait(250)
check(await menu.count() === 1 && await inGroup(1).getByRole('menuitem', { name: 'Move out of this group' }).count() === 0, "Esc shuts the moves and leaves the sheet")
await shot('three-layers')
if (!wide) {
  const fits = await menu.evaluate(m => m.scrollWidth <= m.clientWidth + 1)
  check(fits, '390: three layers without sideways scrolling')
  const deepest = await inGroup(1).getByLabel('Condition').last().boundingBox(), value = await inGroup(1).getByLabel('Property').last().boundingBox()
  check(deepest.width >= 100 && value.width >= 100, '390: the third layer leaves a control readable', [deepest.width, value.width])
  await inGroup(1).getByLabel('Property').last().selectOption({ label: 'Pages' }); await wait(500); await inGroup(1).getByLabel('Condition').last().selectOption('gt'); await wait(400)
  const box = await inGroup(1).getByLabel('Value').last().boundingBox(), size = await inGroup(1).getByLabel('Value').last().evaluate(n => getComputedStyle(n).fontSize)
  check(box.width >= 150 && size === '16px', '390: a value in the third layer is readable, and 16 px', [box.width, size]); await shot('value-390')
}
// The last rule takes its group.
await tap(inGroup(1).getByRole('button', { name: 'Remove filter' }).last()); await wait(800)
check(!view().filterGroups[0].groups, 'taking the last rule takes the group', view().filterGroups[0])
await closeMenu()
// One chip, which opens the sheet and has no ×.
const line = await chips()
check(line.length === 1 && /^Kind is Novel and 1 group/.test(line[0]), 'one chip with the words', line)
check(await block.locator('.database-filter-line .database-chip-remove').count() === 0, 'and no ×')
await shot('chip')
await tap(block.locator('.database-chip-open').first()); await wait(400); check(await menu.getByRole('group', { name: 'Filter group' }).count() === 1, 'it opens the sheet'); await closeMenu()
// A reload, then + New walking it: Kind's value at the top, and in the any group its first single value that works.
await page.reload(); await wait(2500)
const again = await shown(); check(again.has('dune') && again.has('emma') && !again.has('ubik'), 'it stays after a reload', [...again])
await tap(block.locator('.database-table-wrap > .database-new')); await wait(1300)
const made = store().pages.filter(p => p.parentId === 'list').at(-1)
check(made.values?.kind === 'novel' && made.values?.tags?.[0] === 'hist' && made.values?.pages === undefined, '+ New takes what the tree needs', made.values)
if (wide) { await page.keyboard.press('Escape'); await wait(400) } else { await page.goBack(); await wait(1800) }
check(await page.getByText("hidden by this view's filter").count() === 0, 'and shows, so nothing is said')
// Moving in and out.
await openFilter()
const moveRule = async (l, n, name) => { await tap(l.getByRole('button', { name: 'Move rule' }).nth(n)); await wait(250); await tap(l.getByRole('menuitem', { name })); await wait(800) }
await moveRule(menu, 0, /^Move into a new group$/)
check(view().filter.length === 0 && view().filterGroups.length === 2 && view().filterGroups[1].rules[0].by === 'kind', 'a rule moves into a new group', view().filterGroups.map(g => g.rules.length))
await shot('moved')
await moveRule(inGroup(1), 0, /^Move out of this group$/)
check(view().filter[0]?.by === 'kind' && view().filterGroups.length === 1, 'and out, its group going with its last rule')
await moveRule(menu, 0, /^Move in with Pages/)
check(view().filter.length === 0 && view().filterGroups[0].rules.at(-1).by === 'kind', 'in with a group beside it', view().filterGroups[0].rules.map(c => c.by))
await moveRule(inGroup(0), 2, /^Move out of this group$/)
check(view().filter[0]?.by === 'kind' && view().filterGroups[0].rules.length === 2, 'and out again')
await tap(inGroup(0).getByRole('button', { name: 'Group actions' })); await wait(250)
check(await inGroup(0).getByRole('menuitem', { name: 'Remove group and its 2 rules' }).count() === 1, 'removing a group names its rules')
const held = JSON.stringify(view().filterGroups)
await tap(inGroup(0).getByRole('menuitem', { name: 'Remove group and its 2 rules' })); await wait(800)
check(!('filterGroups' in view()), 'Remove group takes it')
await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1000)
check(JSON.stringify(view().filterGroups) === held, 'and its Undo brings it back whole')
await tap(inGroup(0).getByRole('button', { name: 'Group actions' })); await wait(250)
await tap(inGroup(0).getByRole('menuitem', { name: 'Move rules out' })); await wait(800)
check(view().filter.length === 3 && !('filterGroups' in view()), 'its rules join the top, and the field goes', view().filter.map(c => c.by))
await closeMenu()
const plain = await chips(); check(plain.length === 3 && await block.locator('.database-filter-line .database-chip-remove').count() === 3, 'plain chips again', plain)
// Clear filter clears a tree as well.
await openFilter(); await menu.getByLabel('Show rows where').selectOption('all'); await wait(600)
await addTo(menu, '+ Add group'); await wait(700); await setPagesOver(inGroup(0), 100000); await closeMenu()
check((await shown()).size === 0, 'nothing matches'); await tap(block.getByRole('button', { name: 'Clear filter' })); await wait(900)
check(sameRows(await shown(), ...all, made.id) || (await shown()).size >= all.size, 'Clear filter brings them all back'); check(view().filter.length === 0 && !('filterGroups' in view()), 'and empties it')
// At the limit it stops offering.
await openFilter(); for (let i = 0; i < 20; i++) { await addTo(menu, '+ Add filter'); await wait(250) } await wait(600)
check(view().filter.length === 20 && await menu.getByRole('menuitem', { name: '+ Add filter' }).count() === 0 && await menu.getByRole('menuitem', { name: '+ Add group' }).count() === 0, 'at twenty rules it offers no more', view().filter.length)
check(errors.length === 0, 'no page errors', errors.slice(0, 3))
console.log(`[filter-groups ${engine} ${width}] fail ${fails}`)
await browser.close()
process.exit(fails ? 1 : 0)
