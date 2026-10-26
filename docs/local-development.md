# Local development

`npm run dev` starts the app on http://127.0.0.1:3000 with SQLite storage in `.daythread-local/` and sign-in off.
`npm run build` then `npm run preview` serve the production build the same way. A v1 store (from a build before
shot 1) is converted in place the first time it is opened; see `docs/architecture/model-v2.md`.

Checks: `npm run typecheck`, `npm test` (Node's test runner; the v2 model, pages, conversion and storage suites live
in `tests/v2-*.test.ts`), and `scripts/sqlite-browser-smoke.mjs` against a disposable server for the editor's
save-and-retry path. No cloud project, credentials or model call is needed for any of them.

Postgres locally: `DAYTHREAD_STORAGE=postgres DATABASE_URL=...` (the tests use PGlite, Postgres in WebAssembly, so no
server is needed for them). With sign-in off the Postgres store serves one local workspace (`workspaces.user_id` null);
with sign-in on (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, see `docs/ops/credentials.md`) each account has its own.
The real-Postgres tests run when `DATABASE_TEST_URL` points at a disposable database.
