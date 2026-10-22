# Credentials: what to create and where it goes

Five values. Each goes **directly** into `.env.local` on the Mac and/or the Vercel project's environment variables
(scope **Preview** = staging). None goes into chat or git. GitHub needs nothing.

| Variable | Where it comes from | Local `.env.local` | Vercel Preview |
| --- | --- | --- | --- |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | yes | yes |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API → Publishable key | yes | yes |
| `DATABASE_URL` | Supabase → Connect → Transaction pooler (port 6543), `postgres` user with your password | yes | yes |
| `OPENROUTER_API_KEY` | openrouter.ai → Keys. For staging, a separate key with a low credit limit | your current key | the staging key |
| `OPENROUTER_MODEL` | The model id, e.g. `deepseek/deepseek-v4.1-flash-1017`. Optional: unset uses the code default | yes | yes |

## Supabase staging project (once)

1. Create a project named `daythread-staging` in **West US (Oregon)**. The free plan is fine for staging.
2. **Authentication → Users → Add user:** your email, tick **Auto Confirm User**. Do this before step 3.
3. **Authentication → Sign In / Providers → Email:** keep Email on and **turn off "Allow new users to sign up"**. Only
   your account can sign in from then on.

## Vercel

The project is already linked and builds a preview for every PR. Production deploys stay off until the switch.
Optional, only if you want us to run the staging check against protected previews: create **Settings → Deployment
Protection → Protection Bypass for Automation** and pass it to the script when running it:
`VERCEL_AUTOMATION_BYPASS_SECRET=… node scripts/smoke-staging.mjs <preview url>`. It is not app configuration.

## The workspace's linked account

Brian's first successful sign-in links the workspace to his Supabase account (`daythread.workspace.user_id`). From
then on only that account can open it. The database refuses any change to the link (trigger `workspace_user_id_guard`),
so a stray update can't hand the workspace to another account.

If he ever signs in with the right password and sees **"Your account isn't linked to this workspace · Your notes are
safe"**, his Supabase account was recreated and has a new id. His notes are untouched, and 3000 on the Mac still opens
them. **After confirming with him**, relink it to his current account in the Supabase SQL editor, as one transaction:

```sql
begin;
set local daythread.allow_relink = 'on';  -- this transaction only; nothing else can set it
update daythread.workspace
   set user_id = (select id from auth.users where email = '<his sign-in email>')
 where id = 1;
commit;
```

The flag lasts only until `commit`. Sessions of the old account stop working at their next request, and he signs in
once more.
