# Supabase Auth email templates

Pasted by hand into Supabase: Authentication, then Emails, then Templates. The repo copy is the source; change it here
first, then paste.

| Supabase template | Subject | File |
| --- | --- | --- |
| Confirm signup | `Confirm your Daythread address` | `confirm-signup.html` |
| Reset password | `Reset your Daythread password` | `reset-password.html` |

Only these two are sent: sign-up asks Supabase for a confirmation, "Forgot password?" asks for a recovery. Invites are
our own list (`src/server/auth/accounts.ts`), so an invitee's first email is the sign-up confirmation. Magic link,
Change email, Invite user and Reauthentication are never requested and keep Supabase's defaults.

Links stay `{{ .ConfirmationURL }}`: it lands on the Site URL with the token in the fragment, which
`src/routes/sign-in.tsx` reads (`type=signup` signs in, `type=recovery` asks for the new password). A custom
`token_hash` link would not be read.

Style follows `docs/design/system-v2.md`: grey only, like the auth screens; white card with a `#e0e0e0` border and
12px radius; the primary button `#202020`, 8px radius, 48px high; the Home Screen icon as the mark (email clients
don't show SVG).
