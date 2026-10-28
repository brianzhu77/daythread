# Emailed links against Supabase's real auth server (PR A)

Everything here is local and throwaway: no production Supabase, no production database.

## The rig

| Piece | How | Port |
| --- | --- | --- |
| Postgres | `node rig/postgres.mjs` (embedded-postgres; data in `/tmp/rb-gotrue/pg/data`; makes the auth server's roles) | 54888 |
| Mail | `node rig/smtp.mjs`: accepts anything, writes each message to `/tmp/rb-gotrue/mail/NNN.eml` | 2525 |
| Auth server | `git clone https://github.com/supabase/auth && go build -o gotrue .`, then with `rig/auth.env` exported: `./gotrue migrate` once, then `./gotrue` | 9999 |
| Gateway stand-in | `node rig/proxy.mjs`: strips `/auth/v1` like Supabase's gateway | 54321 |
| The app | `npm run build`, then `DAYTHREAD_STORAGE=postgres DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54888/postgres DAYTHREAD_PG_SCHEMA=links_check SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=rig DAYTHREAD_SIGNUP=open npx vite preview --host 127.0.0.1 --port 3580` | 3580 |

`rig/auth.env` shortens two things so a run takes about two minutes: links expire after 30 s
(`GOTRUE_MAILER_OTP_EXP`; production is 24 h since Brian's change on 2026-10-28) and an address can be emailed every
10 s (`GOTRUE_SMTP_MAX_FREQUENCY`; Supabase's hosted default is 60 s). The `/tmp/rb-gotrue` paths are the rig's.

## The checks

- `node probe.mjs http://127.0.0.1:54321 /tmp/rb-gotrue/mail`: the auth server on its own. Output: `probe-output.txt`.
- `node links-e2e.mjs http://127.0.0.1:3580 /tmp/rb-gotrue/mail chromium|webkit`: the app's screens, 21 checks per
  browser. Output: `links-e2e-output.txt`.

## What the auth server does (probe-output.txt)

- An expired link and a used link both land on the Site URL as `#error=access_denied&error_code=otp_expired`; the
  fragment doesn't say which kind of link it was.
- Password sign-in before confirming is 400 `email_not_confirmed` (our 401 `unconfirmed`).
- `resend` with `type: signup` emails an unconfirmed address; for a confirmed or unknown one it answers 200 and sends
  nothing. Within the per-address window it is 429 `over_email_send_rate_limit`.
- `recover` works for an unconfirmed address too, and following that link confirms it. PR A doesn't use it for
  confirmations (a new person would get a "new password" email on day one); sign-in tells the cases apart instead.
- Setting the same password with a recovery token is 422 `same_password`.
