# Password sign-in review — task #112

**PASS ef54ba3 for the changed local implementation.** No new blocking finding. Real Supabase password verification and final hosting checks remain separate; this does not authorize restoring Production.

Scope: password grant, owner refusal, shared backoff, credential handling, removal of OTP routes, and targeted session/draft regressions. Prior gate/Origin/redirect/session conclusions from task #111 remain applicable where unchanged. All execution used my own built checkout, synthetic local Postgres 17 and the fake Auth endpoint. No real journal, 3000 writes, real emails or paid model calls.

## Evidence

- Typecheck and build pass. Full suite: **332 pass, 0 fail, 10 skipped, 4 TODO**.
- Independently executed `tests/auth-postgres-real.test.ts` with my disposable Postgres database: **1 pass**. Four independent connection pools submit 20 simultaneous attempts; exactly five callbacks reach the provider stand-in, fifteen return backoff, and the failure table contains five records. This also exercises first-use setup across instances.
- Independently ran the built-server browser/API harness with fresh schema `ratchet112`: **44 checks pass**. Wrong password, unknown email and verified non-owner produce the same 401 with no session cookie; unavailable provider returns 503. The global wait is returned without recording rejected attempts; existing signed-in devices continue to load. Sign-in clears the failure count after success. Passwords are not echoed, are absent from the URL and captured server log, and the client form does not persist them to editor drafts/local storage.
- The same browser run verifies username/current-password autocomplete, Show, refusal clearing and password focus at 390/1280, one submitted request to `next`, session loss mid-edit followed by saved text recovery, and sign-out token replay refusal.
- Added an independent IP-brake probe using **successful** logins, isolating it from global failure backoff: ten requests succeed, the eleventh returns 429, and the fake provider saw exactly ten calls. Thus a global brake cannot mask a broken IP test.
- Updated independent deployment probes: **28 pass locally**. These check page redirects, real server-function GET/POST rejection, cross-origin/cross-site/no-origin rejection on the password and sign-out endpoints, removed OTP endpoints returning 401, and sign-in page availability. Empty inputs only: no real credential or command is sent.

Logs and scripts: `tests/evidence/ratchet-password-112/`.

## Review conclusions and limits

The global backoff reads, verifies and records under one transaction advisory lock; a denied attempt returns before provider verification or failure insertion. Failure records are shared in Postgres and successful verification clears them. Existing session checks do not consult the failure counter. The IP brake remains per process; it supplements, rather than replaces, the shared global brake. The accepted global denial-of-service tradeoff remains: hostile failures can delay an owner who needs a new sign-in. Existing sessions are unaffected.

No password is included in response construction, debug logs, redirect URLs or persistent browser storage in the changed code. Provider errors become generic responses. Supabase's real password endpoint, provider limits, and a real phone Keychain interaction have not been verified by this local run; Brian's first sign-in supplies the real account check. Fake endpoint tests are not represented as that proof.

The session-table setup now avoids repeating exclusive ALTER operations when its RLS-protected tables exist. The workspace repository's older cold-start ALTER pattern is a separately acknowledged follow-up and is not changed by this review.

## Deployment handoff

Lead runs `node tests/evidence/ratchet-password-112/deployed-probes.mjs` with `REVIEW_URL` and `VERCEL_AUTOMATION_BYPASS_SECRET` privately supplied in the environment, on the isolated test-owner/no-model-key deployment. The probe prints statuses only, no response bodies or credentials. It replaces the OTP-version probe for this candidate; optional `SERVER_FUNCTION_IDS` overrides identifiers if they change in a subsequent build.

Production remains without a public domain, deployment, or database/model credentials per the current Lead directive. The account-binding plan is a separate change, not an implemented or verified property of ef54ba3.
