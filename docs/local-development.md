# Local development

The local backend implements pages, task placements and handoff, saved-material review, capture proposals, review progress, and simulated drafts. The integrated UI includes editable day sections, Start the day, capture receipts, Related and guided review. Supabase, OpenRouter, authentication and reminders are not connected.

Use Node 24 (built with 24.14.1) and npm. Node's native TypeScript support runs the tests. Dependencies are pinned in package-lock.json.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The development server binds to loopback. The dev and preview commands explicitly enable the local storage adapter. This is a single-process development demo; do not expose it publicly.

```sh
npm run build
npm run typecheck
npm test
npm run preview
```

A fresh checkout should build first to generate src/routeTree.gen.ts before typechecking if that generated file is absent. No environment file or accounts are needed. `.env.example` contains future integration placeholders only.

## Storage and API

Data is saved to ignored `.daythread-local/workspace.json` using file flush and atomic rename. Restarting the process keeps the same data. Set `DAYTHREAD_LOCAL_DATA_PATH` to use a separate fixture file. Keep one server process per file: the adapter serializes requests within one process only. It is disabled unless `DAYTHREAD_STORAGE=local`, and rejects Vercel/Netlify environments.

`src/server/functions.ts` exports `loadWorkspace()` and `runCommand({ data: command })`. Commands contain `operationId`, `expectedRevision`, and `action`; see `src/domain/types.ts` and `command-schema.ts`. Retries reuse the same operation ID and payload. A changed payload under the same ID or an outdated workspace revision fails without writing. A new intent uses a new ID and the current revision. Undo is conditional on the latest revision and covers the previous command only.

Capture and draft generation are deterministic simulations, labeled as such in receipts. No request goes to a model and no model cost is incurred. The pure budget-ledger tests do not prove a provider billing integration. Material saving records supplied content and URL; it does not fetch remote pages.

## Evidence and remaining work

Domain and repository checks are in `tests/ACCEPTANCE.md`; `tests/integration-regressions.test.ts` adds four checks for the integration fixes. The repository checks include process restart, duplicate requests and concurrent stale revisions. Independent Chromium checks at 390 × 844 are recorded in `tests/BROWSER-REVIEW.md`; these exercise the integrated server functions. Draft saving after removal and recovery from a save conflict are undergoing final review. No real iPhone, cloud database, authentication, model, provider billing or deployment result is implied by local tests.

Product decisions are in docs/specs-v0.3, its Good Stuffs addendum and review threads. External setup and deployment remain subject to the separate setup proposal.
