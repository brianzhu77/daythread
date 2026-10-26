// A stand-in for Supabase Auth's HTTP API, for the browser run: password grant, sign-up, logout, admin delete,
// recovery (the emailed link's token is read back from /_recovery) and the user behind a token.
// Users live in memory. FAKE_CONFIRM=1 makes sign-up need a confirmation (confirmed later via POST /_confirm).
import { createServer } from 'node:http'
const port = Number(process.argv[2] ?? 54330), confirm = process.env.FAKE_CONFIRM === '1'
const users = new Map() // email -> { id, password, confirmed }
const seed = (process.env.FAKE_USERS ?? '').split(',').filter(Boolean)
let n = 100
const uuid = () => `0000000${++n}`.slice(-8) + '-0000-4000-8000-000000000000'
for (const entry of seed) { const [email, password, id] = entry.split(':'); users.set(email, { id: id ?? uuid(), password, confirmed: true }) }
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || '{}') : {}
  const url = new URL(req.url, 'http://x'), path = url.pathname
  console.log(req.method, path, JSON.stringify({ ...body, password: body.password ? '***' : undefined }))
  if (req.method === 'POST' && path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    const u = users.get((body.email ?? '').toLowerCase())
    if (!u || u.password !== body.password) return json(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
    if (!u.confirmed) return json(res, 400, { error_code: 'email_not_confirmed', msg: 'Email not confirmed' })
    return json(res, 200, { access_token: 'at-' + u.id, user: { id: u.id, email: body.email.toLowerCase() } })
  }
  if (req.method === 'POST' && path === '/auth/v1/signup') {
    const email = (body.email ?? '').toLowerCase()
    if (users.has(email)) return json(res, 422, { error_code: 'user_already_exists', msg: 'User already registered' })
    if ((body.password ?? '').length < 6) return json(res, 422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' })
    const needs = confirm || email.startsWith('confirm-')
    const u = { id: uuid(), password: body.password, confirmed: !needs }
    users.set(email, u)
    if (needs) { u.signupToken = 'sgn-' + Math.random().toString(36).slice(2); return json(res, 200, { id: u.id, email, confirmation_sent_at: new Date().toISOString() }) }
    return json(res, 200, { access_token: 'at-' + u.id, user: { id: u.id, email } })
  }
  if (req.method === 'POST' && path === '/auth/v1/logout') return json(res, 204, {})
  // Recovery: the "email" is a token kept here; the browser run reads it from GET /_recovery?email= and opens the link.
  if (req.method === 'POST' && path === '/auth/v1/recover') {
    const u = users.get((body.email ?? '').toLowerCase())
    if (u) { u.recovery = 'rec-' + Math.random().toString(36).slice(2); u.recoveryEmail = (body.email ?? '').toLowerCase() }
    return json(res, 200, {})
  }
  if (req.method === 'GET' && path === '/_recovery') { const u = users.get((url.searchParams.get('email') ?? '').toLowerCase()); return json(res, 200, { token: u?.recovery ?? null, signup: u?.signupToken ?? null }) }
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  const byToken = () => [...users].find(([, u]) => u.recovery === bearer || u.signupToken === bearer || 'at-' + u.id === bearer)
  if (req.method === 'PUT' && path === '/auth/v1/user') {
    const hit = byToken()
    if (!hit) return json(res, 401, { error_code: 'bad_jwt', msg: 'invalid JWT' })
    if ((body.password ?? '').length < 6) return json(res, 422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' })
    hit[1].password = body.password; hit[1].recovery = undefined
    return json(res, 200, { id: hit[1].id, email: hit[0] })
  }
  if (req.method === 'GET' && path === '/auth/v1/user') {
    const hit = byToken()
    if (!hit) return json(res, 401, { error_code: 'bad_jwt', msg: 'invalid JWT' })
    hit[1].confirmed = true
    return json(res, 200, { id: hit[1].id, email: hit[0] })
  }
  if (req.method === 'DELETE' && path.startsWith('/auth/v1/admin/users/')) {
    if (req.headers.authorization !== 'Bearer sb_secret_fake') return json(res, 401, { msg: 'no' })
    const id = decodeURIComponent(path.split('/').pop())
    for (const [email, u] of users) if (u.id === id) users.delete(email)
    return json(res, 200, {})
  }
  if (req.method === 'POST' && path === '/_confirm') { const u = users.get(body.email.toLowerCase()); if (u) u.confirmed = true; return json(res, 200, { ok: Boolean(u) }) }
  if (req.method === 'GET' && path === '/_users') return json(res, 200, [...users].map(([email, u]) => ({ email, id: u.id, confirmed: u.confirmed })))
  json(res, 404, { msg: 'not found' })
}).listen(port, '127.0.0.1', () => console.log(`fake supabase on ${port}, confirm=${confirm}`))
