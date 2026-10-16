# Independent review of Craft feature map

Ratchet · task #28 · 2026-10-16. Input initially 4e671aa0, then navigation-order revision 4e2c4b15. Reviewed accepted v0.3/Good Stuffs/v0.4 contracts and **sampled original screenshots 255, 364, 409, 432**. I did not independently inspect all 524 images or run Craft. No implementation tested in this review. Third-party images remain outside git.

Conclusion: adapting the document/navigation appearance is reasonable. The following semantic corrections are needed before using the map as an implementation contract.

## F1 · Major: C4 misstates existing explicit Task creation

01 §4.2 explicitly permits `/task` and `[]` in other sections to create Task rows directly; §3.2 says Task placement/reference role survives heading position. C4 says only plan sections/capture create Tasks and all other checkbox lines are plain checklists. That is a proposed change, not unchanged D12. Existing ordinary Task references must never turn into plain text because they appear on another page. Recommend distinguish three objects: plain checklist; explicit Task creation (`/task`, existing `[]` shortcut unless Brian changes it); ordinary reference to an existing Task. Only explicit planning creates a Placement. A plain checklist option may be added as a new proposal. Preserve Task identity on migration. Test same Task in Notes and Top3; changing title/done reflects same identity, moving its presentation never duplicates or removes commitment.

## F2 · Major: C2 must compare arrangement membership, not visible body rows

After bulk presentation deletion, the accepted Task remains planned and appears as Planned · not in note. Tasks→Today/Calendar must still include it even though no body row exists. Specify canonical included Placement membership and order, one row per Task/day, with explicit indication if absent from note; compare against day plan **including** its facts/recovery area. Don't build these lists from Block text or create placements while browsing dates. Past Calendar entries use historical placement, not current plannedOn, so moving a task to tomorrow does not erase its history. Date facts remain distinct: plannedOn, attentionOn, deadlineOn; paused Tasks still expose real deadline/attention facts. Red only for passed real deadline. Add hidden-row, completed/cancelled, moved-history, paused-deadline and five-item previous-day handoff cases.

## F3 · Major: C5 Auto does not always require confirmation; Page depends on v0.4

03 §1/§4 and 01 §4.3: clear pure-new group can apply directly; existing mutations/mixed group await confirmation, and removing mutations in Edit does not remove the confirmation gate. Multi-line/ambiguous input previews. Auto cannot silently revert this contract. Direct Task/Page avoids AI, but define source/destination/URL and type errors; a date chip changes planned date only, never silently changes deadline. Steps 1–4 cannot all use only the current data model if Page promises v0.4 URL dedup/restoration/backlinks; explicitly depend on the page API or keep the chip out until it is ready.

## F4 · Major: C6 and Duplicate need entity-specific effects and honest labels

Screenshot 255 proves an action labelled Move to Daily Note exists; static screenshots do not prove what it does to source identity. Our prose Bring copies text+provenance and leaves source; Task Keep reuses Task and explicitly plans today (clears pause), retaining deadline/attention. Use Bring to today for prose and Keep/Plan today for Task, not a generic Move label implying source removal. New transport replay must not duplicate a copy, but a new deliberate copy remains possible. Page-card Bring reuses Page ID and adds a reference, never moves the tree parent or resets follow-up. Generic Copy/Duplicate of Task blocks must make references to the same Task, not new Tasks/placements. New independent commitment needs explicit Duplicate task. Add cut/drag/duplicate cases alongside A19/D05 and the accepted editor-spike rules.

## F5 · Evidence/copy cleanup

- Image 409 is Notifications→Reminders, with time-based overdue text. It does not establish that Craft's planned task dates universally become overdue. Mark that inference unverified; screenshots 364/432 establish Calendar/This Day presentation only. Likewise “every checkbox anywhere is a Task” needs a known flow or qualification, not a static universal claim.
- Templates row says daily template is fixed; 03 §5/01 permit renaming, adding/removing sections and writing anywhere. Say default template; imported gallery is out of scope.
- Skip list says separators are omitted while insert list includes separator. Pick one routine default and state it consistently.
- “Capture receipt Copy” promises Undo while the existing new-Capture code may not yet render Undo. Treat as target behavior, not evidence of implementation.

No need for extra Brian decisions for factual corrections F1/F3 or entity invariants F2/F4. The deliberate checklist/default-chip choices can still go to him with corrected baseline. These findings don't block Jazz token-only styling. Follow-up review should record the actual input hash and distinguish document resolution from runtime verification.
a0c9383ce581dd1253b9c900a49ebdd10bc73cdb8c5203408bf0bd2c3a6d4880  docs/reviews/craft-study/feature-map.md

## Final recheck 269830198386e376f886056caeba129c1bd133b2512533043c9006e06be394f2

F1–F5 and follow-up qualifiers are resolved: current Task shortcuts versus proposed checklist behavior distinguished; full Auto confirmation contract restored; Tasks/Calendar includes hidden-plan recovery and historical moved/excluded placements; generic Move/Duplicate effects corrected; v0.4 dependency explicit; screenshot 409 inference qualified; template/separator/receipt wording corrected. K1–K9 cover the key invariants. Calendar browsing is read-only while opening the editor follows P12; K5 excludes real overdue deadlines. No remaining document blocker. Pending C1/C4/C5 are still Brian choices, to be accepted through v0.4.1, not implicitly by this study. No runtime/Craft behavior validation inferred from document approval.
