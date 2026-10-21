# Tab visibility refresh — independent review

Candidate 74c2fe4; Ratchet; 2026-10-21. **Changes required: a delayed refresh can replace newer saved editor text with an older workspace snapshot.** No production writes or data-format changes; all browser tests used isolated fresh read-only VACUUM copies of Brian's database.

## Confirmed issue

The new visibility handler flushes before starting its load, but the user may continue typing while that load is in flight. A saved command may complete after the load fetched its snapshot but before the snapshot arrives. `refresh()` in use-day.tsx always calls `adopt(next)`, even when next.revision is older than the current workspace revision.

Independent test intercepts one real refresh GET, fetches the response and holds delivery, types a unique marker and waits for autosave, then releases the older response. The editor loses the just-saved marker. SQLite still retains it; a later successful refresh can restore it. This is a stale UI regression, not a claim of stored-data loss. The test also confirms typing was visible immediately before delivering the old response.

Suggested fix: prevent an out-of-date load result from replacing the newer adopted workspace, and return the adopted current workspace to any caller that needs it. Add this precise response-order test. Preserve the existing dirty-editor protection for typing that has not yet saved.

## Passing checks

- Build and typecheck passed.
- Independently ran the author's two-tabs.mjs on Chromium at 1280, using /private/tmp/ratchet95-chrom.sqlite, port 3404: all passed.
- Independently ran the same checks with WebKit at 390, separate /private/tmp/ratchet95-web.sqlite, port 3405: all passed. These cover refresh after the other tab's save, caret/scroll preservation, stale save refusal, and preserving both competing drafts.
- Own race/availability checks on a third copy, port 3406: duplicate focus/visibility events coalesce to one load; normal typing Undo works after refresh; failed refresh leaves text and editing intact; later focus retries after network recovery. Four passed; the delayed-response case above failed.

## Evidence and limits

Evidence: tests/evidence/ratchet-refresh-95/{chromium.log,webkit.mjs,webkit.log,race.mjs,race.log,race-confirmed.log,typecheck.log}.

The original two-tab harness actively dispatches focus to simulate returning; it does not prove native iPhone Safari emits visibility/focus events. Own WebKit run is a 390px viewport; Jazz separately checked mobile WebKit with touch. Real phone access is not set up on the localhost deployment. No native Safari/iPhone claim.

Initial engine runs accidentally shared one isolated database, so they were stopped and discarded; final engine runs use separate fresh copies. The initial extra race harness selected an absent populated bullet on Oct 19 and timed out; it was corrected to an existing Oct 18 bullet before the result above. Those setup failures are not product findings. No full visual geometry rerun was needed: this change affects lifecycle and data loading, with no layout/style changes; caret and scroll were explicitly checked.
