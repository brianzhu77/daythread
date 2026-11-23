// Tap feedback release 2 (#374, docs/design/tap-feedback.md §4): a change drawn before the server answers, taken back
// with its word when the server holds it, and the working mark on a change that waits. Reseeds a throwaway store per
// case; never his data.
// Usage: node tests/evidence/draw-ahead/r2-probe.mjs <base-url> <store-path> [chromium|webkit]
//   The server at <base-url> serves <store-path> (a build: `vite preview`, so the outbox route below matches).
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'

const [base, storePath, only] = process.argv.slice(2), results = []
if (!base || !storePath) { console.error('Usage: node tests/evidence/draw-ahead/r2-probe.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const OUTBOX = '**/_serverFn/cedd5fc6*'
const PAGE = 'probe-page'
const repo = () => new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
const elsewhere = async action => { const r = repo(), w = await r.load(); await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action }) }
const reseed = async () => {
  execSync(`node --no-warnings tests/evidence/tap-feedback/seed.ts ${storePath}`, { stdio: 'ignore' })
  await elsewhere({ type: 'create-document', title: 'Trip notes', body: 'Packing list', pageId: PAGE })
}
const titleOf = async () => (await repo().load()).pages.find(p => p.id === PAGE)?.title

for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch()
  for (const width of [390, 1280]) {
    const tag = `${engine} ${width}`
    const fresh = async () => {
      await reseed()
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, ...(width < 600 && engine === 'chromium' ? { hasTouch: true } : {}), timezoneId: 'America/Vancouver', serviceWorkers: 'block' })
      const page = await context.newPage()
      await page.goto(`${base}/pages?page=${PAGE}`); await page.locator('[aria-label="Page title"]').waitFor({ timeout: 30000 })
      await page.waitForLoadState('networkidle').catch(() => {}); await wait(600)
      return { context, page }
    }
    const toasts = page => page.evaluate(() => [...document.querySelectorAll('[data-slot="toast"]:not([data-exiting="true"])')].map(e => e.textContent.replace(/\s+/g, ' ').trim()))
    const rename = async (page, words) => { const t = page.locator('[aria-label="Page title"]'); await t.click(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A'); await page.keyboard.type(words); await t.evaluate(e => e.blur()) }

    // 1. Drawn ahead: a rename shows everywhere before the answer (held 3 s). At 1280 the sidebar names it; at 390 the
    //    browser tab's title does.
    {
      const { context, page } = await fresh()
      let answered = 0
      await page.route(OUTBOX, async r => { await wait(3000); answered = Date.now(); await r.continue().catch(() => {}) })
      const t0 = Date.now()
      await rename(page, 'Trip to Lisbon')
      let seenAt = null
      for (let i = 0; i < 40 && seenAt === null; i++) {
        const shown = await page.evaluate(() => [...document.querySelectorAll('nav a, aside a, [role=treeitem]')].some(e => /Trip to Lisbon/.test(e.textContent)) || /Trip to Lisbon/.test(document.title))
        if (shown) seenAt = Date.now() - t0; else await wait(50)
      }
      ok(`${tag} 1 rename drawn before the answer`, seenAt !== null && seenAt < 1000 && answered === 0, `shown at ${seenAt} ms, answer ${answered ? 'came' : 'still held'}`)
      await wait(3500)
      ok(`${tag} 1 and saved once answered`, (await titleOf()) === 'Trip to Lisbon', await titleOf())
      await context.close()
    }

    // 2. Held: renamed elsewhere after this tab loaded, then renamed here. His typed name stays in the field with the line
    //    under it, no generic notice, the banner keeps its way back; Esc gives up and shows the saved name.
    {
      const { context, page } = await fresh()
      await elsewhere({ type: 'rename-page', pageId: PAGE, title: 'Trip (phone)' })
      await rename(page, 'Trip to Porto')
      let line = ''
      for (let i = 0; i < 60 && !(line = await page.locator('.title-not-saved').textContent().catch(() => '') ?? ''); i++) await wait(100)
      const field = await page.locator('[aria-label="Page title"]').textContent()
      const ts = await toasts(page), body = await page.locator('body').textContent()
      ok(`${tag} 2 held rename: his name stays in the field`, field === 'Trip to Porto', field)
      ok(`${tag} 2 held rename: said under it`, line === 'Name not saved · changed elsewhere', line)
      ok(`${tag} 2 held rename: no generic notice on top`, !ts.some(t => /not saved/.test(t)), ts.join(' / '))
      ok(`${tag} 2 held rename: the banner keeps its way back`, /Keep mine/.test(body) && /Discard/.test(body))
      ok(`${tag} 2 held rename: nothing saved over the other device`, (await titleOf()) === 'Trip (phone)', await titleOf())
      await page.locator('[aria-label="Page title"]').click(); await page.keyboard.press('Escape'); await wait(400)
      ok(`${tag} 2 Esc gives up: the saved name, no line`, (await page.locator('[aria-label="Page title"]').textContent()) === 'Trip (phone)' && !(await page.locator('.title-not-saved').count()))
      await context.close()
    }

    // 3. Held, generic word: Delete from Page actions while the page was renamed elsewhere. The page goes at once, then
    //    comes back with `Delete not saved · changed elsewhere` in the same visible change.
    {
      const { context, page } = await fresh()
      await elsewhere({ type: 'rename-page', pageId: PAGE, title: 'Trip (phone)' })
      const menu = page.getByRole('button', { name: 'Page actions' }).first()
      if (await menu.count()) {
        await menu.click(); await wait(150)
        await page.getByRole('menuitem', { name: 'Delete' }).click()
        let ts = []
        for (let i = 0; i < 60 && !(ts = await toasts(page)).some(t => /not saved/.test(t)); i++) await wait(100)
        ok(`${tag} 3 held delete: named notice`, ts.some(t => t.startsWith('Delete not saved · changed elsewhere')), ts.join(' / '))
        ok(`${tag} 3 held delete: the page is still there`, Boolean((await repo().load()).pages.find(p => p.id === PAGE && !p.trashedAt)))
      } else ok(`${tag} 3 held delete: Page actions found`, false, 'no Page actions button at this width')
      await context.close()
    }

    // 4. Waits: New page shows the working mark on the button and takes no second press while the answer is held 2 s.
    {
      const { context, page } = await fresh()
      await page.route(OUTBOX, async r => { await wait(2000); await r.continue().catch(() => {}) })
      await page.route('**/_serverFn/**', async r => { await wait(2000); await r.continue().catch(() => {}) })
      if (width < 600) { await page.goto(`${base}/pages`); await page.getByRole('button', { name: 'New page' }).first().waitFor({ timeout: 30000 }); await wait(600) }
      const before = (await repo().load()).pages.filter(p => p.type !== 'daily').length
      const add = page.getByRole('button', { name: 'New page' }).first()
      if (await add.count()) {
        await add.click(); await wait(150)
        const item = page.getByRole('menuitem').first()
        if (await item.count()) {
          await item.click()
          const marked = await add.evaluate(e => e.getAttribute('data-working')).catch(() => null)
          await wait(400)
          const slow = await page.evaluate(() => document.querySelector('[data-working]')?.getAttribute('data-working') ?? null)
          await page.locator('[data-working]').first().click({ force: true, timeout: 500 }).catch(() => {})
          ok(`${tag} 4 waits: working mark, then the spinner after 300 ms`, (marked !== null || slow !== null) && slow === 'slow', `at once ${marked}, at 400 ms ${slow}`)
          await wait(3500)
          const after = (await repo().load()).pages.filter(p => p.type !== 'daily').length
          ok(`${tag} 4 waits: one page made, not two`, after === before + 1, `${before} → ${after}`)
          ok(`${tag} 4 waits: the mark is gone after the answer`, !(await page.locator('[data-working]').count()))
        } else ok(`${tag} 4 waits: New page menu`, false, 'no menu item')
      } else ok(`${tag} 4 waits: New page button`, false, 'not on this screen')
      await context.close()
    }
  }
  await browser.close()
}
const failed = results.filter(r => !r).length
console.log(failed ? `${failed} FAILED of ${results.length}` : `all ${results.length} passed`)
process.exit(failed ? 1 : 0)
