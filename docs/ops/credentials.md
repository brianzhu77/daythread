# Credentials: what to create and where it goes

For Brian. Every value goes **directly** into the place named below. None of them goes into chat, git or this file.
Variable names and comments are in `.env.example`.

**Places:**
- **Local:** `.env.local` in the repo folder on the Mac mini. It's ignored by git.
- **Vercel Preview:** the Vercel project, Settings → Environment Variables, scope **Preview**. This is staging: every PR gets a preview deploy.
- **Vercel Production:** the same screen, scope **Production**. Leave it empty until the switch.
- **GitHub:** nothing. CI needs no secrets.

## 1. Vercel project (once)

1. On vercel.com, **Add New → Project** and import `brianzhu77/daythread`. The framework is detected as TanStack Start with Nitro. Leave the build settings at their defaults, and leave Node.js at 24 (it comes from `package.json`).
2. **Settings → Deployment Protection:** keep **Vercel Authentication** on for previews. Then create **Protection Bypass for Automation** and copy its secret into Local as `VERCEL_AUTOMATION_BYPASS_SECRET`, so the smoke check can reach previews.
3. **Settings → Functions:** confirm the region is **Portland, USA (pdx1)**. The build also sets it.
4. Production deploys from `main` are off for now (`vercel.json`) and get turned on at the switch.

## 2. Supabase staging project (once)

1. On supabase.com, create a new project named `daythread-staging`, region **West US (Oregon)**. The free plan is fine for staging because it holds no real data. Save the database password in your password manager.
2. **Project Settings → API:**
   - Project URL → `VITE_SUPABASE_URL` in Local and in Vercel Preview.
   - Publishable key → `VITE_SUPABASE_PUBLISHABLE_KEY` in Local and in Vercel Preview.
3. **Connect → Connection string:**
   - **Direct connection (or Session pooler, port 5432)**, with the `postgres` user and your password, goes into Local only, as `DATABASE_MIGRATION_URL`.
   - **Transaction pooler (port 6543), as the `daythread_app` role**, goes into Vercel Preview and Local as `DATABASE_URL`. The role and its password are created by our first migration. We'll tell you when to copy this one.
4. **Authentication → Providers → Email:** keep it enabled and **turn off "Allow new users to sign up"**. `DAYTHREAD_OWNER_EMAIL` (your email) goes into Local and Vercel Preview.

## 3. Model key for staging

On openrouter.ai, create a **separate key** for staging with a low credit limit. Put it in Vercel Preview as `OPENROUTER_API_KEY`, and set `OPENROUTER_MODEL` to the same model id you use now. Your current key stays in Local.

## 4. Cron secret

`CRON_SECRET` is any long random string, for example from `openssl rand -hex 32`. It goes into Vercel Preview. The endpoint that uses it comes with the direct build.

## Done when

- A PR gets a Vercel preview deploy.
- `VERCEL_AUTOMATION_BYPASS_SECRET=… node scripts/smoke-staging.mjs <preview url>` prints **all passed**.
