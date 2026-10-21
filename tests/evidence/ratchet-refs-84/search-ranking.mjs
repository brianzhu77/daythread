// A9a `[[` + B15 in the built app (vite preview) on a copy of Brian's database: Jazz page-links-states §6 checks
// 1–6 and 8–10, plus the plan's §7 browser cases (IME composition and the extra input after it, paste, in-app copy,
// lines shown outside the editor). A real Chinese input method is NOT used: composition is simulated with events.
//   node ui-check.mjs <base url> <db path> <pristine copy> <shots dir> <playwright index.mjs>
import { copyFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const [base, dbPath, pristine, out, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const today = '2026-10-20', R = 'fa95e8a3-dd0a-4b3c-8fcc-c1129c8c4820' // 韩国大酱汤, a child of Sun Oct 18
const errors = []
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
const reset = () => { for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true }); copyFileSync(pristine, dbPath) }
const sql = q => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare(q).all() } finally { d.close() } }
const sections = id => JSON.parse(sql(`SELECT sections FROM pages WHERE snapshot='current' AND id='${id}'`)[0].sections)
const refsOn = id => sections(id).flatMap(s => s.blocks).flatMap(b => (b.refs ?? []).map(r => ({ ...r, blockId: b.id })))
const b = await chromium.launch()
async function open(path = '/', width = 1280) {
  const p = await b.newPage({ viewport: { width, height: 900 } })
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await p.goto(`${base}${path}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
  return p
}
const block = (p, id) => p.locator(`.bn-block-outer[data-id="${id}"]`)
const clickLine = (p, id) => block(p, id).locator('.bn-inline-content').first().click()
const menu = p => p.locator('.bn-suggestion-menu')
const menuText = async p => (await menu(p).count()) ? (await menu(p).first().innerText()) : ''
const chips = (p, id) => block(p, id).locator('.page-ref')
const settle = p => p.waitForTimeout(1300)
const notes = `day:${today}:notes:template:0`
const linkedFromText = async p => (await p.locator('.linked-from').first().innerText().catch(() => '')).replace(/\s+/g, ' ')


reset();const {SqliteWorkspaceRepository}=await import('../../../src/server/sqlite-repository.ts');const r=new SqliteWorkspaceRepository(dbPath);for(const [id,title]of[['starts','needle start'],['contains','other needle']]){const w=await r.load();await r.execute({operationId:crypto.randomUUID(),expectedRevision:w.revision,action:{type:'create-document',pageId:id,title,body:''}})}
const p=await open();await clickLine(p,notes);await p.keyboard.type('[[needle');await p.waitForTimeout(700);const t=await menuText(p);console.log(t);log(t.indexOf('needle start')<t.indexOf('other needle'),'prefix match ranks before substring match');await b.close();
