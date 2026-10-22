// A stand-in for Supabase Auth's email-code endpoints, for the sign-in checks only. Two accounts exist; sign-ups are
// off. Codes are single-use, last 10 minutes, and an address may ask again only after 60 s, as Supabase does.
import { createServer } from 'node:http'
const port = Number(process.argv[2] ?? 54999)
const users = new Map([['owner@example.com', 'u-owner'], ['other@example.com', 'u-other']])
const codes = new Map(), lastSend = new Map()
let projectLimit = false
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); let raw = ''; for await (const c of req) raw += c
  const body = raw ? JSON.parse(raw) : {}
  if (url.pathname === '/__code') return json(res, 200, { code: codes.get(url.searchParams.get('email'))?.code ?? null })
  if (url.pathname === '/__expire') { const c = codes.get(url.searchParams.get('email')); if (c) c.expires = 0; return json(res, 200, {}) }
  if (url.pathname === '/__limit') { projectLimit = url.searchParams.get('on') === '1'; return json(res, 200, {}) }
  if (url.pathname === '/__reset') { lastSend.clear(); return json(res, 200, {}) }
  if (req.headers.apikey !== 'pk') return json(res, 401, { msg: 'No API key' })
  if (url.pathname === '/auth/v1/otp') {
    if (projectLimit) return json(res, 429, { error_code: 'over_email_send_rate_limit', msg: 'Email rate limit exceeded' })
    if (body.create_user !== false) return json(res, 400, { msg: 'test expects create_user: false' })
    if (!users.has(body.email)) return json(res, 422, { error_code: 'otp_disabled', msg: 'Signups not allowed for otp' })
    const wait = 60_000 - (Date.now() - (lastSend.get(body.email) ?? 0))
    if (wait > 0) return json(res, 429, { error_code: 'over_email_send_rate_limit', msg: `For security purposes, you can only request this after ${Math.ceil(wait / 1000)} seconds.` })
    lastSend.set(body.email, Date.now())
    codes.set(body.email, { code: String(100000 + Math.floor(Math.random() * 900000)), expires: Date.now() + 600_000, used: false })
    return json(res, 200, {})
  }
  if (url.pathname === '/auth/v1/verify') {
    const c = codes.get(body.email)
    if (body.type !== 'email' || !c || c.used || c.expires < Date.now() || c.code !== body.token) return json(res, 403, { error_code: 'otp_expired', msg: 'Token has expired or is invalid' })
    c.used = true
    return json(res, 200, { access_token: 'at-' + body.email, user: { id: users.get(body.email), email: body.email } })
  }
  if (url.pathname === '/auth/v1/logout') { res.writeHead(204); return res.end() }
  json(res, 404, {})
}).listen(port, '127.0.0.1', () => console.log(`READY http://127.0.0.1:${port}`))
