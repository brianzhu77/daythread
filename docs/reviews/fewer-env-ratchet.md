# Four-variable setup review

Task106, candidate a7ac4ac, Ratchet, 2026-10-22.

**PASS for the setup simplification.** `.env.example` exposes exactly SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, DATABASE_URL and OPENROUTER_API_KEY. Credentials instructions keep owner provisioning before disabling signup; bypass credentials remain script-only. core-build §0 explicitly supersedes migration URL, cron and owner-email configuration and accurately calls the privileged-URL role wrapper an application-enforced boundary.

Independent targeted verification: typecheck passes; 25 model service/ledger/cost-lookup tests pass using temporary stores/fake provider settings. Direct modelConfig assertions cover absent/blank key → simulated, key only → DEFAULT_MODEL, and explicit test-model override. Compared only the current local model-id field with DEFAULT_MODEL: equal. No secret values printed, no provider calls, no live writes or process changes.

The four-variable contract is the new core's deployment surface. Supabase public configuration delivery, DATABASE_URL storage selection and withOwner isolation are not implemented by this small change; C1/C2/C4 remain responsible. Existing SQLite/test controls still exist internally and need not be exposed to Brian. No new issue found in this diff; no additional build or full browser regression was needed for the unchanged screens and targeted default change.
