# Credentials: what to create and where it goes

Four values. Each goes **directly** into `.env.local` on the Mac and/or the Vercel project's environment variables
(scope **Preview** = staging). None goes into chat or git. GitHub needs nothing.

| Variable | Where it comes from | Local `.env.local` | Vercel Preview |
| --- | --- | --- | --- |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | yes | yes |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API → Publishable key | yes | yes |
| `DATABASE_URL` | Supabase → Connect → Transaction pooler (port 6543), `postgres` user with your password | yes | yes |
| `OPENROUTER_API_KEY` | openrouter.ai → Keys. For staging, a separate key with a low credit limit | your current key | the staging key |

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
