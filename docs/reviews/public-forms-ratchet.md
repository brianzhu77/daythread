# Public forms: independent boundary review

Reviewed 2026-11-04 UTC, `forms.md` at 3bc4dc50. Design review only; no endpoint exists and no exploit was executed. I read the design and relevant command/template contracts before other reviewers' findings.

**Verdict: keep public links off.** The direction is sound, but §5 is not yet a sufficiently narrow implementation contract. Only-me Forms can proceed independently. These are gaps in the design, not confirmed deployed vulnerabilities.

## 1. Anonymous submission inherits private command authority (blocking)

§4 says answers use `add-row` and fire Row added automations. `automations.md` §4 allows Edit rows in and Add row to, and later external steps. A per-form response cap does not bound the number of private rows touched, outbound actions, or processing per accepted submission. Public Relation refusal alone does not prevent an owner-configured default template/automation from writing relations or other private databases.

Acceptance scenario: configure an ordinary Row added automation that edits rows in another database, then submit anonymously. Specify whether this is intentionally allowed before implementing. Recommendation: construct the row server-side from published writable question IDs; carry an explicit public origin through the command. Default to no automation/default-template side effects for public submissions. Any later opt-in must enumerate allowed effects, budget them atomically with the submission, and prevent recursion/external effects without a separate decision. Never accept owner, database, page, property mapping, template, copyOf, action, or automation IDs from the visitor.

## 2. Limits are aspirational rather than enforceable (blocking)

“Per form and per address, with a daily cap” has no stated numbers, unit (attempts or successful rows), byte/question/option limits, concurrency behavior, or failure policy. A hidden field does not impose a resource bound. Rotate-link must not reset the form/workspace quota; distributed addresses must not bypass the hard aggregate budget.

Acceptance scenario: send simultaneous valid submissions at the last remaining quota slot from different addresses and different Worker instances. Exactly the remaining number may commit; retries must not consume another slot. Refused/oversized/bad-token requests must be rejected before loading the private workspace or doing expensive work. State per-link read limits, per-form and workspace write/storage budgets, trusted address source, shared durable accounting, and fail-closed behavior when accounting is unavailable. Choose concrete limits before public enablement, measure them on the Worker, and make the owner able to reopen after a cap.

## 3. Retry identity and link revocation need one atomic contract (blocking)

“One row, by an id made when the form opened” is not enough to define retry authority. A visitor controls that ID. The design must state a server-owned namespace, retention window, payload binding and how successful retries behave after closure/reset. It must not reuse a generic workspace operation ID that could retrieve an unrelated receipt.

Acceptance scenarios: repeat the same key with different answers; use it on another form; retry after a lost response; race Reset link with a held submission; remove a question or add a required one while a submit is held. Bind the key to form generation plus a normalized payload hash, return only a minimal public receipt, reject mismatched reuse, and check current publication/generation/schema in the same transaction as row creation. No old-generation write may commit after reset takes effect. No generic workspace/patch/Undo data in success or errors.

## 4. Public reads need an explicit publication projection (blocking)

“Only questions” must enumerate allowed fields. Direct serialization of a View, Database, Property or command receipt can expose private filter values, relation targets, formulas, defaults, response count, row IDs or option metadata. Public Relation can become available later if the owner changes a published question's property type without revalidation.

Acceptance scenarios: GET a form after adding private filters/defaults; change a question's type to Relation/Files/read-only; trash its containing database; send unknown question IDs and nested objects. Public GET should return only an allowlisted published schema, with intentionally public wording/options. Revalidate every GET/POST and parent lifecycle; never trust what was safe when initially published. Closed/deleted/nonexistent responses must match in status and body. Render wording, confirmation and answers as text; validate supported URL schemes at the later clickable rendering boundary.

## 5. Response privacy must follow derived data (blocking before the stated privacy promise)

§5 promises no public answers in usage reads, logs or the day-draft model unless manually placed on a day. Plain values do not encode that provenance, and automated copies, relations, rollups, formulas, titles and errors can carry an answer into other material.

Acceptance scenario: an answer is copied by an automation/template into a day or referenced through a relation, then draft collection runs. Define persistent public-response origin and what counts as deliberate owner placement; enforce exclusions in model collection, analytics, request/error logging and instrumentation. If copies cannot retain that policy, narrow the privacy promise explicitly rather than claiming it holds. No POST-body capture in diagnostics; public caches must not store personalized/error/answer responses.

## Nonblocking observations

- Unguessable revocable links, no app shell, plain values, no answer URL fetching, and refusing public Relations/Files are useful foundations.
- No account credentials or ambient owner session should be required or accepted on the public submit path. Publishing, rotating, reopening and cleanup remain authenticated, owner-checked operations with the existing CSRF boundary.
- CSRF/drive-by submissions, third-party framing and automated spam need explicit tests in addition to a honeypot. A challenge is one control; it does not replace aggregate quotas or the narrow write boundary.
- Cleanup Undo must remove only that form's response lineage and must not undo later private edits accidentally. It needs the same stale-write guards as other bulk commands.

No claim of implementation safety until these contracts and their real-Postgres/Worker tests exist. Brian's explicit approval remains required by §5 even after a passing review.
