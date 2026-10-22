# Sign-in independent review — task #111

**PASS 3abb7e3 for the local implementation. Deployment verification and Brian's first real OTP sign-in remain separate gates.** The public Production domain stays removed, existing Production deployments stay inaccessible, and Vercel protection stays enabled on `live` (Lead 071b2b66).

Reviewed independently in `daythread-ratchet-sign-in` using synthetic databases and a fake Auth endpoint. No real Supabase connection, journal writes, real emails, paid model calls or changes to 3000.

## Findings resolved

1. **Owner change did not revoke existing access (81dbd15).** A still-valid former-owner session passed the request gate despite a different current `OWNER_EMAIL`. Reproduced on a local Postgres-backed built server: GET `/` returned 200. In 3abb7e3 the gate and account lookup compare the current owner; the same case returns 302 and deletes the session row.
2. **Post-login external redirect (81dbd15).** `next=/\evil.example` passed the string-prefix filter but resolves to an external HTTPS origin in a browser. In 3abb7e3 URL normalization and same-origin validation reject this and the other tested external forms; local path/query/hash are retained.
3. **Auth-off lacked the local-only boundary.** The original config only rejected recognized hosting environments. The follow-up checks the socket address per request and rejects forwarding headers. Independently tested a built server bound to `0.0.0.0`: loopback 200, LAN 403, forwarded requests 403. This enforces request access rather than refusing the bind/start itself; keep 3000 explicitly bound to `127.0.0.1` as planned. Hosting-off rejection is covered by the tests.

## Independent verification

- Final typecheck and production build pass.
- Full suite: **330 pass, 0 fail, 9 skipped, 4 TODO**. Skipped real-Postgres tests are not represented as executed by that suite.
- Ran the author's browser/API harness against my own local Postgres 17 database, fresh `ratchet111final` schema and fake Auth: **26 checks pass**. It covers anonymous gate, unknown/cooldown reply equivalence, non-owner verification refusal, invalid/expired/reused codes, cookie and hash storage, session loss mid-edit with restored saved text, sign-out and replay refusal.
- Added independent direct probes: **29 checks pass locally**, covering five page redirects, anonymous API and actual server-function identifiers (GET and POST), cross-origin/cross-site/missing-origin rejection on send/verify/sign-out, and the public sign-in page. No workspace command or valid email payload is submitted.
- Independently repeated both security findings after the fixes and exercised the auth-off server over loopback/LAN/forwarded requests. See `tests/evidence/ratchet-sign-in-111/`.

## Deployed handoff

Lead holds the Vercel credentials. Run `node tests/evidence/ratchet-sign-in-111/deployed-probes.mjs` with `REVIEW_URL` and `VERCEL_AUTOMATION_BYPASS_SECRET` supplied privately through environment variables. The script prints only statuses, never response bodies, cookies or secret values. `SERVER_FUNCTION_IDS` optionally overrides the six identifiers from this reviewed build.

Use the isolated deployment/schema/test-owner setup specified by Lead. A passing signed-out deployment probe is required before Brian's setup/login step. It does not validate real email delivery, Supabase cooldown response details, an authenticated production round-trip, or the final hosting configuration. Brian's first active sign-in supplies the real OTP check while Vercel protection remains on. No Production domain may be restored or Production access enabled on this report alone. Lead has already unpaused the project to permit Preview builds, while keeping the former public domain removed and existing Production deployments inaccessible.

The send endpoint's IP brake is per instance and not a distributed limiter; Supabase remains the upstream limit. Browser code receives neither the database URL nor Supabase credentials by this design. No claim is made about the earlier anonymous production access window; that incident's read evidence remains unknown as reported by Lead.

## Final UI delta — 0e1988d

Reviewed the diff from 3abb7e3: only sign-in interaction and sign-in/account CSS change. The server gate, session handling, owner check, redirect validation and off-switch are unchanged, so the earlier security results remain applicable. The code clears and refocuses after refusal and guards automatic submission with the last submitted complete code and the busy state. No additional security finding in this delta. Jazz owns the independent browser validation of the revised input behavior; Lead reruns deployed probes on this final head. This paragraph is a diff review, not a claim that I reran the browser or suite on 0e1988d.
