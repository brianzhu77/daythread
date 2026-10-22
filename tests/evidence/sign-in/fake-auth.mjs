// A stand-in for Supabase Auth's password grant, for the sign-in checks only. Two accounts exist; sign-ups are off.
// /__down makes it answer 503; /__calls counts password checks, so a test can see which tries reached it.
import { createServer } from 'node:http'
const port = Number(process.argv[2] ?? 54999)
const users = new Map([['owner@example.com', { id: 'u-owner', password: 'owner-pass-1' }], ['other@example.com', { id: 'u-other', password: 'other-pass-1' }]])
let down = false, calls = 0
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); let raw = ''; for await (const c of req) raw += c
  const body = raw ? JSON.parse(raw) : {}
  if (url.pathname === '/__down') { down = url.searchParams.get('on') === '1'; return json(res, 200, {}) }
  if (url.pathname === '/__calls') return json(res, 200, { calls })
  if (req.headers.apikey !== 'pk') return json(res, 401, { msg: 'No API key' })
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    calls++
    if (down) return json(res, 503, {})
    const user = users.get(body.email)
    if (!user || user.password !== body.password) return json(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
    return json(res, 200, { access_token: 'at-' + body.email, user: { id: user.id, email: body.email } })
  }
  if (url.pathname === '/auth/v1/logout') { res.writeHead(204); return res.end() }
  json(res, 404, {})
}).listen(port, '127.0.0.1', () => console.log(`READY http://127.0.0.1:${port}`))
