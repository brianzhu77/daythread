// What Supabase's auth server does with the links and re-sends PR A relies on, asked directly (no app in between).
//   node tests/evidence/sign-in-links/probe.mjs http://127.0.0.1:54321 /tmp/rb-gotrue/mail
import fs from 'node:fs'
const [AUTH, MAIL] = process.argv.slice(2)
const A = AUTH + '/auth/v1', run = Date.now().toString(36), sleep = ms => new Promise(r => setTimeout(r, ms))
const post = async (path, body) => { const r = await fetch(`${A}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return `${r.status} ${(await r.text()).slice(0, 160)}` }
const mails = to => fs.readdirSync(MAIL).sort().map(f => fs.readFileSync(`${MAIL}/${f}`, 'utf8').replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))).filter(m => m.includes(`To: ${to}`) || m.includes(`<${to}>`))
const link = to => /href="([^"]*verify[^"]*)"/.exec(mails(to).at(-1) ?? '')?.[1]?.replace(/&amp;/g, '&')
const land = async href => { const r = await fetch(href, { redirect: 'manual' }); return (r.headers.get('location') ?? '').replace(/access_token=[^&]+/, 'access_token=<token>').replace(/refresh_token=[^&]+/, 'refresh_token=<token>') }
const say = (what, value) => console.log(`${what}\n    ${value}`)

const u = `u-${run}@rig.local`, e = `e-${run}@rig.local`, c = `c-${run}@rig.local`, pw = 'pw-long-enough-1'
const t0 = Date.now()
say('sign-up (e: its link is left to expire)', await post('signup', { email: e, password: pw }))
say('sign-up (u)', await post('signup', { email: u, password: pw }))
say('password sign-in before confirming', await post('token?grant_type=password', { email: u, password: pw }))
say('resend signup within the minute (10 s on the rig)', await post('resend', { type: 'signup', email: u }))
await sleep(10_500)
say('resend signup, unconfirmed', `${await post('resend', { type: 'signup', email: u })}; emails to it: ${mails(u).length}`)
say('resend signup, unknown address', await post('resend', { type: 'signup', email: `nobody-${run}@rig.local` }))
const fresh = link(u)
say('the re-sent link lands on', await land(fresh))
say('the same link again (used) lands on', await land(fresh))
await sleep(10_500)
const n = mails(u).length
say('resend signup, now confirmed', `${await post('resend', { type: 'signup', email: u })}; emails to it: ${n} -> ${(await sleep(500), mails(u).length)}`)
await sleep(Math.max(0, 31_000 - (Date.now() - t0)))
say('e\'s confirmation link after 31 s (GOTRUE_MAILER_OTP_EXP=30) lands on', await land(link(e)))
say('sign-up, unconfirmed (c)', await post('signup', { email: c, password: pw }))
await sleep(10_500)
say('recover, unconfirmed (c)', `${await post('recover', { email: c })}; subject: ${/^Subject: (.*)$/m.exec(mails(c).at(-1))?.[1]}`)
say('its link lands on', await land(link(c)))
say('password sign-in after following it (it confirmed the address)', (await post('token?grant_type=password', { email: c, password: pw })).slice(0, 40))
