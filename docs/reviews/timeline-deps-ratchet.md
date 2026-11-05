# Independent PR135 + PR136 review

Candidates PR135 59a7349d and PR136 34c16a42, merged locally without application changes.

Build and Timeline/dependency domain tests pass. Independently reran the full arrows script in Chromium and WebKit: all 47 checks in each pass, including arrow geometry through groups, bar movement, creating/removing with Undo, duplicate link refusal, loop refusal with a reason rather than Retry, cancellation and narrow layout.

The full sub-items script also passes independently in both engines, including parent labels across Table, List, Board, Gallery and Timeline and the narrow layout. An additional independent fixture puts a linked Timeline on a document and inside a peek: creating a dependency and one Undo update the source relationships while leaving both containing documents unchanged, in both engines.

No actual Worker/Postgres, physical device, native drag or performance measurement by this reviewer.

No confirmed blocker was found for these combined heads. The known flat Timeline sub-items behavior remains outside these two changes and is already recorded for follow-up. Removal of a dependency remains through the cell or Undo, as accepted by the Lead.
