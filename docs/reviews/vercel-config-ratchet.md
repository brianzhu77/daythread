# Vercel configuration review

Candidate: `08dacb0`, `chore/vercel-ci`. Reviewer: Ratchet. 2026-10-22.

**Changes required before acceptance.** This is configuration and credential-instruction review, not deployment or auth acceptance.

## Findings

1. **Smoke accepts unrelated HTML / protection pages.** `scripts/smoke-staging.mjs:17` accepts any 200 response containing `</html>`, follows redirects, and silently disables Vercel checks when the header is missing. Independently ran the unchanged script against a temporary local HTTP fixture serving `<html><body>Authentication Required</body></html>` for all paths. It printed four successful renders and `all passed`, exit 0. Require app/route-specific evidence, reject unexpected redirects/error/protection screens, and make local mode explicit rather than infer it from a missing header. Include negative cases. Until authentication exists, this cannot prove signed-in screens work.

2. **Smoke confuses edge and function regions.** Line 21 uses `id.includes('pdx1')`. Fixture `x-vercel-id: pdx1::iad1::review-fixture` plus immutable dummy asset returns `all passed`, exit 0, while the function segment is iad1. Parse/assert the function region, not any region in the chain, or use an app runtime-region assertion. Reject missing execution evidence.

3. **Owner creation missing in credentials instructions.** Lead independently identified this: disabling signup before provisioning Brian's auth user prevents first login. Add explicit Add user / auto-confirm or another supported owner provisioning step. This candidate contains no Supabase auth implementation, so owner login and non-owner refusal remain future auth acceptance cases. Design specifies identical visible messages for every email; refusal means no code/session/data access, not a revealing visible error.

## Independently checked

- Fresh isolated worktree and `npm ci`: exit 0.
- `npm run typecheck`: exit 0.
- `TZ=America/Vancouver FUTURE_DAYS_CONTRACT=1 npm test`: 306 pass, 0 fail, 4 TODO.
- Both normal and `DAYTHREAD_TARGET=vercel` builds: exit 0.
- Generated `.vercel/output/functions/__server.func/.vc-config.json`: nodejs24.x, pdx1, maxDuration60. Output routing gives `/assets/*` immutable caching and SSR catch-all.
- Normal build uses dist/client + dist/server; Nitro is conditionally registered. No own server or 3000 changes.
- CI uses pull_request + main push, read-only contents permission, checkout without persisted credential, no secret references, install/type/test/both builds. Actual GitHub Actions execution remains required on PR; local run is not Linux CI proof.
- `.env.example` contains placeholders/non-secret defaults; migration privileged connection is local only. VITE variables are limited to publishable project details and existing dev banner flags. Runtime DB/model/cron secrets have no VITE prefix.
- Existing storage.ts refuses local SQLite on VERCEL/NETLIFY. Cloud core is not implemented; a successful build does not imply usable cloud app.
- main Git auto-deployment is disabled in vercel.json. Vercel project import/manual deployment and account settings are not verified by that file.

## Limits and next owner

Roadbuster fixes the smoke and owner setup instructions and supplies PR CI result. Ratchet checks the revised diff and negative cases. No Vercel/Supabase accounts, secrets, deployment, sign-in, RLS, cron recovery, or real cloud region/latency have been exercised here.

References checked: [Nitro Vercel preset/runtime](https://nitro.build/deploy/providers/vercel), [Vercel response headers](https://vercel.com/docs/headers/response-headers#x-vercel-id), [Git deployment configuration](https://vercel.com/docs/project-configuration/git-configuration).
