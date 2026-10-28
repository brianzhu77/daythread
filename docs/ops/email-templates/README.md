# Supabase Auth email templates

Pasted by hand into Supabase: Authentication, then Emails, then Templates. The repo copy is the source; change it here
first, then paste.

| Supabase template | Subject | File |
| --- | --- | --- |
| Confirm signup | `Confirm your email for Daythread` | `confirm-signup.html` |
| Reset password | `Choose a new Daythread password` | `reset-password.html` |

Only these two are sent: sign-up asks Supabase for a confirmation, "Forgot password?" asks for a recovery. Invites are
our own list (`src/server/auth/accounts.ts`), so an invitee's first email is the sign-up confirmation. Magic link,
Change email, Invite user and Reauthentication are never requested and keep Supabase's defaults.

Links stay `{{ .ConfirmationURL }}`: it lands on the Site URL with the token in the fragment, which
`src/routes/sign-in.tsx` reads (`type=signup` signs in, `type=recovery` asks for the new password). A custom
`token_hash` link would not be read.

Style follows `docs/design/system-v2.md`: grey only, like the auth screens; white page, no card, one 440px column;
the primary button `#202020` with white text, 8px radius; the Home Screen icon (`/icon-192.png`, 28px) as the mark,
since email clients don't show SVG; the sign-in tagline as the footer; the link written out under the button for
clients that break it. Inline styles only (no `<style>`, no classes), so Gmail's stripping changes nothing; light only
(`color-scheme: light`), and it stays readable when Apple Mail inverts it. Checked in Chromium at 390 and 1280, and at
390 with an inversion filter; not yet in a real mail client.
