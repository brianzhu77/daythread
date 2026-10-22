// Rollback proof for the workspace link (Lead, Ratchet ce…/pre-review): the new build links and writes; the previous
// build (PR #5 head ef54ba3) then starts on that same database, signs in, saves, reloads and writes the model ledger;
// the new build starts again and the link, the text and the ledger are all still there.
//   node tests/evidence/workspace-link/rollback.mjs <new build dir> <old build dir> <postgres url> <schema> <auth url>
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'
import postgres from 'postgres'
const [NEW, OLD, DB, SCHEMA, AUTH] = process.argv.slice(2)
const sql = postgres(DB, { prepare: false, onnotice: () => {} })
const OWNER_ID = '0aaaaaaa-0000-4000-8000-000000000001'
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`) }
const env = { ...process.env, DAYTHREAD_STORAGE: 'postgres', DATABASE_URL: DB, DAYTHREAD_PG_SCHEMA: SCHEMA, SUPABASE_URL: AUTH, SUPABASE_PUBLISHABLE_KEY: 'pk', OWNER_EMAIL: 'owner@example.com' }
delete env.VERCEL; delete env.DAYTHREAD_AUTH
async function serve(dir, port) {
  const child = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port)], { cwd: dir, env, stdio: 'ignore', detached: true })
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/sign-in`); break } catch { await new Promise(r => setTimeout(r, 250)) } }
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { process.kill(-child.pid) } catch {} } }
}
async function signIn(base) {
  const r = await fetch(base + '/api/auth/sign-in', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: 'owner-pass-1' }) })
  return { status: r.status, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] }
}
async function type(base, cookie, text) {
  const browser = await chromium.launch(), context = await browser.newContext()
  const [name, value] = cookie.split('=')
  await context.addCookies([{ name, value, url: base }])
  const page = await context.newPage()
  await page.goto(base + '/', { waitUntil: 'networkidle' })
  const editor = page.locator('.bn-editor[contenteditable="true"]').first()
  await editor.click(); await page.keyboard.press('Meta+ArrowDown'); await page.keyboard.press('Enter')
  await page.keyboard.type(text); await page.waitForTimeout(2500)
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  const shown = (await page.textContent('body')) ?? ''
  await browser.close()
  return shown
}
const row = async () => (await sql.unsafe(`select user_id::text as u, revision, data::text as data, ledger::text as ledger from ${SCHEMA}.workspace`))[0]

// 1. New build: the first sign-in links; a line is typed.
let app = await serve(NEW, 3491)
let s = await signIn(app.base)
log(s.status === 200, 'new build: owner signs in', String(s.status))
log((await row()).u === OWNER_ID, 'new build: the workspace is linked to his account')
let shown = await type(app.base, s.cookie, 'line from the new build')
log(shown.includes('line from the new build'), 'new build: typed line saved and shown after reload')
app.stop(); await new Promise(r => setTimeout(r, 1000))

// 2. Old build on the same database: starts, signs in, saves, reloads, and writes the model ledger.
app = await serve(OLD, 3492)
const old = await signIn(app.base)
log(old.status === 200, 'old build: starts on the linked database and signs in', String(old.status))
shown = await type(app.base, old.cookie, 'line from the old build')
log(shown.includes('line from the new build') && shown.includes('line from the old build'), 'old build: saves and reloads, both lines shown')
app.stop()
// The old build's own repository code writes the model ledger on the same row.
const { PostgresWorkspaceRepository } = await import(`${OLD}/src/server/postgres-repository.ts`)
const { postgresClient } = await import(`${OLD}/src/server/db/sql.ts`)
const oldRepo = new PostgresWorkspaceRepository(postgresClient(sql), SCHEMA)
await oldRepo.reserveModelAttempt({ id: 'rollback-attempt', subject: { kind: 'capture', id: 'c', revision: 1 }, day: '2026-10-22', upperBoundUsd: 0.004, model: 'fake/model', requestHash: 'h', now: new Date().toISOString() })
await oldRepo.recordModelResult({ attemptId: 'rollback-attempt', actualUsd: 0.001, generationId: 'g', now: new Date().toISOString() })
log((await row()).ledger.includes('rollback-attempt'), 'old build: model ledger written')
log((await row()).u === OWNER_ID, 'old build: the link is untouched')

// 3. New build again: the link, both lines and the ledger are there; the old build's session still works.
app = await serve(NEW, 3493)
const page = await fetch(app.base + '/', { redirect: 'manual', headers: { cookie: old.cookie } })
log(page.status === 200, "new build: the old build's session (same account) still opens today", String(page.status))
shown = await type(app.base, old.cookie, 'line after rolling forward')
log(['line from the new build', 'line from the old build', 'line after rolling forward'].every(t => shown.includes(t)), 'new build: all three lines shown')
const final = await row()
log(final.u === OWNER_ID && final.ledger.includes('rollback-attempt'), 'new build: link and ledger kept', `user_id ${final.u}`)
app.stop(); await sql.end()
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0)
