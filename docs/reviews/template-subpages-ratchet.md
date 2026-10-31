# B70 part 2 independent review

**Final verdict: PASS — PR #35 `4e93918`.** All four confirmed findings below are resolved.

Task #236. Reviewed PR #35 from `4613932` through consolidated head `4e93918`, combined locally with PR #34 and account-row PR #36 `9d312e7`. All data is invented. SQLite is `/tmp/ratchet236.sqlite`; Postgres runs on loopback port 54889 with a unique throwaway schema per replay, removed afterwards. No production or preview data was read or changed.

## Findings and resolution

1. **One-row templates lost their row on preview.** On `4613932`, a template containing one empty task or bullet was classified as a blank page. Preview insertion replaced that row with a paragraph. Independent `preview.ts` failed. `81413d8` checks the template copy first and preserves the original row below the quote; both independent cases pass.
2. **Delete bypassed failed-save protection.** On the initial implementation, typing followed by a forced save-editor 503 and Delete still removed the template. Undo restored its old server document; newer words remained only in the browser draft. Reported `cad5dfb1`. The fix calls `flushEditor` and refuses deletion when it fails. Independent `delete-failed-fixed.mjs` confirms the template stays open and stored. Happy-path Delete/Undo also preserves its default and document.
3. **Default configuration counted as a child page.** On `5e37b4f`, assigning another template to the new link page suppressed its pending preview despite an untouched body. Reported `e9857f63`. `b4de223` excludes templates from the child check; independent `preview-target.ts` now receives the title and excerpt while keeping Summary below it.
4. **Long nested targets widened the screen.** On `b4de223`, WebKit 390 rendered the target select 838 px wide and the document 858 px wide. It also escaped the 700 px text column at 1280. Reported `1220a8df`. Jazz's `20a194d`, included unchanged in `4e93918`, makes the head track and label shrinkable. Independent geometry now ends exactly at the title's right edge: x1120 at 1280 and x370 at 390, without horizontal overflow.

Jazz's separate corrections are included: the built-in day line remains available after creating a blank template, and every page-target option says “Pages in …”, with its parent path.

## Independent verification

- **Postgres:** every command uses a fresh repository load. All four targets persist; the specific day/page target takes precedence over the generic day-subpage target. Defaults are direct-parent rules, not inherited from grandparents. New titles stay their own, copied tasks stay empty, nonempty bodies and moved pages remain unchanged. Link preview quote is inserted above preserved template nodes, while a late preview leaves a page with new words/title alone. Delete/Undo and target Trash/restore pass. No real Task is created by editing or copying these templates.
- **Browser:** Chromium 1280 and WebKit 390, light and dark: New template focuses title; typing saves; four target choices survive reload; Pages + and /Page use the selected template; Delete returns to Templates and Undo restores the row/default. The default-day explanatory line remains accessible. Native select options distinguish nested targets.
- **Boundary states:** long nested target fits both widths. Trashed target remains named “in Trash”, without trashing its template. The app has no permanent-delete command; a forced missing-target fixture renders None, allows reassignment, and does not block another default.
- **Diagnostics:** one dark WebKit flow on the earlier CSS logged `ResizeObserver loop completed with undelivered notifications` while all functional assertions passed. After the shrinkable-track fix, the same isolated dark flow passes without that diagnostic. This was retained in the earlier log.

Evidence: `tests/evidence/ratchet-b70-part2/`. Initial failing reproductions and corrected runs are retained. Replay scripts mutate their fixed invented fixture and should be seeded before replay.

## Harness corrections and limits

The initial browser flow clicked before hydration and overlapped fixture seeding; the final replay waits for the client account row and seeds first. Reusing a parent after a failed /Page attempt left slash text in its first line; the final replay creates a fresh empty tail line, uses realistic caret pauses, and clicks the visible Page suggestion. Delete/Undo waits for the returned list before invoking Undo. Those harness failures are not counted as product defects.

The first alignment fixture lacked a written plain day in October, producing two MISSING picker-dot cases. A separate invented written day supplies that coverage; no product change was needed.

Physical iPhone, installed Home Screen mode, and the deployed Worker transport are outside these checks. The Postgres repository is exercised directly; Lead owns preview isolation and deployment checks. No existing page is migrated by this change.

## Final combined checks

The actual template screen plus the full row/picker fixture passes **201 checks, 0 failed, 0 missing** at 1280 and 390 on the consolidated revision. Long-target geometry is independently checked at x1120/x370. Final combined typecheck, build and suite pass: **173 passed, 0 failed, 3 credential-dependent skips**. The final isolated dark WebKit flow after the CSS fix emits no page errors.
