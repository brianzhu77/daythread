# Credentials: what to create and where it goes

Each value goes **directly** into `.env.local` on the Mac and/or the Vercel project's environment variables
(scope **Preview** = staging, **Production** = the live app). None goes into chat or git. GitHub needs nothing.

| Variable | Where it comes from | Local `.env.local` | Vercel |
| --- | --- | --- | --- |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | yes | yes |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API → Publishable key | yes | yes |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API → Secret key. Optional: with it, Delete account removes the login too | optional | optional |
| `DATABASE_URL` | Supabase → Connect → Transaction pooler (port 6543), `postgres` user with your password | yes | yes |
| `DAYTHREAD_SIGNUP` | `invite` (the default) or `open`. Who may sign up or sign in for the first time | optional | optional |
| `DAYTHREAD_INVITES` | Invited addresses, comma-separated. Optional: the `daythread.invites` table does the same without a redeploy | optional | optional |

`OWNER_EMAIL` is no longer read (shot 2): any account with a workspace signs in; the invite list decides who gets one.

## Supabase staging project (once)

1. Create a project named `daythread-staging` in **West US (Oregon)**. The free plan is fine for staging.
2. **Authentication → Users → Add user:** your email, tick **Auto Confirm User**. Do this before step 3.
3. **Authentication → Sign In / Providers → Email:** keep Email on and **keep "Allow new users to sign up" on**: our
   server is the gate (the invite list), and Supabase has to accept the sign-up it forwards. "Confirm email" may stay
   on; a new address then signs in after clicking the link Supabase sends (the built-in mailer is rate-limited; custom
   SMTP is a launch item).

## Vercel

The project is already linked and builds a preview for every PR. Production deploys stay off until the switch.
Optional, only if you want us to run the staging check against protected previews: create **Settings → Deployment
Protection → Protection Bypass for Automation** and pass it to the script when running it:
`VERCEL_AUTOMATION_BYPASS_SECRET=… node scripts/smoke-staging.mjs <preview url>`. It is not app configuration.

## The invite list

While `DAYTHREAD_SIGNUP` is `invite` (the default), an address may sign up, or sign in for the first time, only when it
is on the list. Two ways to add one; neither needs a deploy for the first:

```sql
insert into daythread.invites (email) values ('someone@example.com');
```

or `DAYTHREAD_INVITES=someone@example.com,another@example.com` in the environment. An invite is marked `used_at` at
the first sign-in. Flipping to `DAYTHREAD_SIGNUP=open` lets anyone sign up.

## Accounts and their workspaces

Every account (`daythread.accounts`) has one workspace (`daythread.workspaces`, `user_id`); its pages, tasks and
operations carry the workspace id. Brian's shot 1 row was migrated into his workspace on the first start of the shot 2
build; the old table is kept as `daythread.workspace_shot1` for rollback (rename it back to `workspace` and redeploy
the shot 1 build). Delete account (the account row, with the password) removes the workspace and the sessions; the
Supabase login goes too when `SUPABASE_SECRET_KEY` is set, else it stays and a new sign-in starts an empty workspace.
