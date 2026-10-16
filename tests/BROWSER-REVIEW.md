# Local browser review (Ratchet, task #21)

Status: DONE for the assigned local repository and phone-width paths. Historical pending items below are closed by the later verification sections. Cloud/model/real-device gaps remain explicitly unverified.

Environment: independent test worktree, UI 2d89e56 plus domain fixes through 28a85d8; Chromium via browse, 390×844 viewport; Vite 127.0.0.1:3012 with separate /tmp/daythread-ratchet-browser.json. Sample button created the aged material. No cloud or model call, no real iPhone or notification delivery.

Executed:
- Sample yesterday handoff: Keep moved the selected Task to today; Bring copied one material line; Done dismissed the handoff.
- Capture: initial build required Apply for new input (known defect); after 71261d6/28a85d8 rerun, a new Chinese task saved immediately with simulated receipt and no Apply button.
- Existing Tax return moved from Other to Top 3 after the domain fix. Page section inspection confirmed it under the Top 3 section.
- Review opened with from=reminder. Saved items displayed one material saved four days earlier. All three choice buttons and the whole card fit the viewport. Make it a task and custom watching date were inside the ⋯ menu. No saved-material count appeared in the day/review screens inspected. Horizontal width was 390/390.
- Finish directly on Saved items showed Review saved; independently read persisted reviewSaved=true from the local file.
- After the fix, Make it a task created one Task, plannedOn=null and zero Task blocks anywhere. Receipt showed Task created · Unscheduled.
- Prepare tomorrow showed simulated Top 3 choices and Related for tomorrow: calmtech.com. The Related line and save button fit the viewport. Screenshots inspected: evidence/saved-items-390.png, evidence/related-390.png.
- No console errors observed in these flows.
- Independent native rerun after domain fixes: 35/35 pass. Read author integration-regressions.test.ts; its four cases cover identity/reference preservation on Top 3 move, draft serialization, new-only versus mixed Capture, and unscheduled material conversion. These are domain tests despite the filename; they do not exercise HTTP.

Pending:
- Jazz save-draft wiring: remove one task and one Related item, save, reload/next day and verify both stay removed; failed save preserves editable choices and Retry.
- HTTP-level replay/schema rejection, actual iPhone keyboard/browser behavior, iOS reminder delivery, cloud auth/RLS, actual provider context/usage billing. Repository replay/stale/restart checks are recorded separately in ACCEPTANCE.md.
- Pages/Upcoming, multiline semantic AI preview and [[ references are declared implementation gaps, not covered by this run.

## 69cf3cb draft UI verification

Normal Save for tomorrow persists two task IDs and zero material IDs after removing one task and the only Related item; receipt counts 2 task suggestions. Browser reload and independent file read retained those selections.

Confirmed remaining defect: remove one task and Related, advance the repository revision with an independent add-text command, then save. The screen retains both edits and displays Not saved / Retry, but repeated Retry never recovers because wsRef retains the stale revision. Reported to Jazz (a7512693), Lead confirmed (9a04cce9). Pending fix: refresh latest workspace, intersect retained local selections with latest draft candidates, prompt about dropped candidates, require explicit save. No automatic replay or overwrite. This remains open; the normal path above does not close it.

## d8051c4 conflict recovery, independently verified

The remaining stale-save defect is closed. At 390×844, started with 3 task and 2 material candidates, removed one of each locally, then injected a second valid draft candidate set into the isolated dev file with an increased workspace revision. This deliberately changed both candidate sets, not just the version (fixture injection, not a real second device/model result).

On save failure the screen loaded the newest draft, kept the two local removals, displayed one new Task and one new material as Updated on another device, and reported two formerly kept items no longer offered. Before explicit Retry, independent disk inspection still showed the second draft's 3/2 candidates: no automatic replay. Retry then persisted exactly the visible 2 Tasks and 1 new material; independent disk read and browser reload retained that result. The receipt counted 2 task suggestions. Screenshot evidence/conflict-390.png was inspected. The generic workspace refresh is shared by all commands in use-day.tsx; this browser check specifically exercised save-draft. No real device or external model claims.
