# Buttons: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **approved to build, in §7's order (Lead 962245dd, 2026-11-05); Roadbuster builds.** Steps that reach outside the app stay undecided, one at a time. #152 goes out first, and the first build that can make a button waits until it's live. Not built past #152.
- Asked by the Lead (3f046122). Scope rule: nothing cut for lack of evidence, and his use only sets the order (Brian 57deaed7). `databases.md` §14 puts Buttons in "Later", waiting for this pass.
- **Evidence:** Notion's help pages on [page buttons](https://www.notion.com/help/buttons) and [database buttons](https://www.notion.com/help/database-buttons). I read them; I haven't used Notion's buttons. Those pages don't cover the phone, a button in a table cell, or running one on several rows, so those parts below are my proposal, not Notion's behaviour.
- **His use:** he had no databases at the last read (Nov 2). Nothing here comes from watching him, so the examples are illustrations.

## 1. The idea

A button is a saved action that runs with one tap. It comes in two forms, with one set of steps:

- **On a page:** a block from `/` Button.
- **On a database:** a property of type Button, one per row, which acts on that row.

Example: a "Log a run" button in his Day template adds a row to Runs with today's date. Each new day has the button, because a template copies its blocks.

## 2. Steps

| Step | Page button | Property | What it does here |
| --- | --- | --- | --- |
| **Insert blocks** | yes | no | Adds blocks above or below the button, or at the top or bottom of its page. To-dos in them are template rows until inserted (B70's rule), so each click makes its own new tasks. A `@date` chip gets a new event each time. |
| **Edit property** | no | yes | Sets properties on this row, with add and remove for Multi-select and Relation. |
| **Add row to** | yes | yes | Adds a row to a database with set values. In To-dos it's `+ New` (R2-11). |
| **Edit rows in** | yes | yes | Edits the rows of a database that match a filter. In To-dos it uses the same task commands (R2-9). |
| **Open page or URL** | yes | yes | Opens a page, the row just made, or a link. |
| **Show confirmation** | yes | yes | Shows his own text with Continue and Cancel. It's a step he adds, so the default is no dialog. |
| **Define variables** | yes | yes | Named values for later steps. |

**Values in a step:** a fixed value, `@today`, `@this page`, `@this page's day` and, on a property, this row's values. `@this page's day` is read at the click, so a button on a template or on an old day does what the page shows. A value can also be a formula, and so can the name of a row a step adds.

**What a formula reads (G3-10):**

- **The row:** Edit rows reads the row being edited. Every other step and every variable reads the row tapped, or the row that set off a rule. On a page outside a database it reads only the page's name, and on a schedule the same, as there's no row.
- **Variables:** a formula reads the variables of the steps above it, and those above it in its own step. Each is worked out once, when its step runs, so a variable can carry the tapped row's value into Edit rows. A later step defining the same name replaces it for the steps after.
- **Time:** `now()` and `today()` are the tap's, in the workspace's zone, on the server. A retry gets the same answer.
- **Order:** a step reads what the steps before it wrote. Edit rows works out every row before writing any, so rows don't depend on each other's order.
- **Fit:** the field says what it gives, or why it can't. Done is off until each fits its property. A select takes an option's name, ignoring case; a name that isn't an option refuses the tap rather than adding one. Empty clears the property.
- **Cost:** a formula reading only its row's own stored values costs about nothing. One reading a formula, rollup or relation property reads the whole workspace again for each row tapped, so a tap may do that 100 times at most. Over that the whole tap is refused, "Too many rows for N's formula · 100 at most", rather than the first rows changed (Ratchet, Bumblebee).
- **Failing:** one that can't work drops the whole tap and names its step, as any other step's failure does (§4). On a rule that pauses the rule.
- **Renaming a variable** doesn't rewrite the formulas that use it. They show the error, and Done stays off until they're changed.
- **Rollback:** a list with a formula or a variable is written as version 2, which a floor build reads as no steps, so it can't run a formula as something else. A list without either stays version 1.

**Steps that reach outside the app:** Send webhook, Send mail, Send Slack message and Send notification. They stay in scope, but none has what it needs yet: credentials, outgoing requests from the server, or notifications. **For the Lead:** each is its own decision with its own risk, so they aren't in the first release. Webhook is the likely first, since it needs no account, and it must refuse private addresses.

## 3. What he sees

- **On a page:** a compact outlined pill, with a label he types (an emoji typed into it just shows). Black, white and grey (116a40ab), 44 px on the phone. It takes its own line, indented like the line it's nested under.
- **In a table, list or card:** the same pill, with the property's label, in the row's cell. It doesn't open the row.
- **On a row page:** in the property list at the top.
- **Making one:** `/` Button opens the editor straight away: a Name field and `+ Add step`. It's a popover at 1280 and a sheet at 390, as other database settings are. Done is off while a step is incomplete, and the step that's incomplete is marked, as Notion refuses to save one with setup errors.
- **Editing:** a small `⋯` beside the pill, on hover at 1280 and always visible at 390 (Jazz, Roadbuster 276d88ca), with Edit, Duplicate and Delete. A tap on the pill always runs it.
- **Keys at 1280:** it's a block that can be selected whole. Enter from there runs it, and keys don't leak (R1-26).

**Jazz's answers (36161d64, decided by the Lead 962245dd; these replace what's above where they differ):**

- **Leaving the editor.** With no changes, a tap outside or Esc closes it, and a new button with no finished step leaves no block. With changes, a tap outside does nothing, and Esc or back asks one line: "Discard changes? Keep editing · Discard".
- **Steps as a list.** One row per step, such as "Add row to Runs", with ↑↓ and ×. Tapping a row opens that step's own page with a back arrow, as the Filter and property sheets do. An incomplete step says what's missing. Done sits in the sheet's head, and tapping it while it's off goes to the first incomplete step.
- **Waiting.** Same place and size at reduced opacity, as the sign-in button does. After about 300 ms, a spinner replaces the label with its width held.
- **Size.** "44 px" means the tap area. Drawn 36 on a page line and 28 in a cell, with the tap area filling its line or row and never reaching the next. A press doesn't start a card's drag or a line's swipe-to-select, and a swipe or scroll doesn't run it. A long label ends in an ellipsis.
- **Enter.** It runs a button only when the button alone was selected by its handle. Arriving by arrow does what other blocks with no text do. In a table cell, Enter runs it, and Delete and paste do nothing.
- **A blank label** reads "Button", on the page and in export. Button version data stays inside `steps`, as that string is all the floor can keep (Lead).

**After a tap:** the usual notice, naming the result, with Undo. Each reads from what ran:

| Result | Notice |
| --- | --- |
| One row added | "Added to Runs · Open · Undo" |
| Rows edited | "3 rows changed · Undo" |
| Blocks inserted | "Inserted · Undo" |
| Several steps | The last step's words |
| To-dos that can't take the change (decided, Lead 371ebb4b) | Those that can change, as R4-17's bar does: "3 changed · 1 couldn't · Undo". Refusing the whole tap isn't what a person gets from the same edit on the bar. This is for a task refusing the change only: an invalid value in the step is a broken step, which aborts the tap and leaves nothing (Ratchet ef1044db) |
| Filter matched nothing | That step does nothing and later steps carry on. "No rows matched" only if nothing at all changed (Bumblebee, on Ratchet 6c8ed9c9): a button that adds a row and then edits matching ones shouldn't lose the row because nothing matched |

There's no explanatory line anywhere (Daythread's rule, Brian 1ac6784b).

## 4. Rules that protect his data

1. **One tap, one change, one Undo.** All the steps run as one command, so they all apply or none do. Our `undo` already targets one operation, and an operation can cover many changes, so "Edit rows in" with `set-values-many` fits. A failure names the step, and leaves everything as it was.
2. **A second tap while one is running does nothing.** A retry after a lost reply can't run it twice, using the same operation id as other commands.
3. **Offline:** it doesn't run or queue, and says "Not run · offline". A delayed action that fires later is worse than a refused one.
4. **Broken targets show at the click:** "Runs is in Trash" with Restore, or "Status was deleted" with Edit. The pill stays. Other steps don't run. A deleted database doesn't delete the button.
5. **Copying:** a copied button is a separate button with the same steps, in a page, a template or a duplicate row's body. In a synced block it's one button (`synced-blocks.md`), and in another app it's its label as text.
6. **A template doesn't run steps.** The button works on the day made from it. On the template itself a tap opens Edit.

**Contracts before building (Ratchet 6c8ed9c9, a design read, not run):**

7. **Confirmation before writes, navigation after commit.** Every confirmation is collected before anything's committed. Open page or URL happens in the browser after a successful commit, so a blocked popup never retries the data changes. "All or none" means the stored changes; a page already opened can't be rolled back.
8. **It starts from saved words and the intended button.** The flush has to finish successfully, including a save already in flight (#141 showed awaiting one flush isn't enough). It runs against a stored button identity and the expected content, including a synced record's, and if those changed it refuses or refreshes. Words typed while the command is on its way survive its reply.
9. **One tap keeps one identity and bounded work.** A retry keeps its operation id, input, generated row, task and event ids, and the tap's date, so `@today` isn't read again after midnight. All targets and the whole step list are checked before anything applies. Limits are counted across steps and selected rows, rather than each step spending the full 500 to-dos or 10,000 rows.

## 5. Engineering answers (Roadbuster 6ef1eb57, from reading the code, not prototyped)

- **Insert blocks with other steps: one server command.** `run-button` does every step in one operation, including writing the inserted blocks into the document, so there's one Undo and no need for the fallback. `apply-draft` and `rename-task` already change a document and tasks together. About a day.
- **Limits of that, which I accept for the product:**
  - The open editor saves what's been typed before the click, so the command starts from what he sees.
  - The way back is the notice's Undo, not ⌘Z in the editor, and it's refused after later changes, like any notice's Undo.
  - A page open in another tab learns of it when he returns to that tab. Unsaved typing there gets the real conflict notice.
- **Old tabs and the rollback floor:** the floor rises for the block, so it ships in two steps, as the database block did: first a release with the block spec and no way to make one, which becomes the floor, then the feature. The property type is confirmed by running it, as R3-17 asks.
- **Where the steps live:** in the block's props and the property's settings, with ids read at the click (§4.4).
- **Automations (`automations.md`):** one shared list of steps.

## 6. Open

- **A property button on several selected rows.** Notion's pages don't say. I'd run it on each, with one Undo and "3 rows changed", at 1280 now and on the phone with R3-15.
- **Sort, filter and Group on a Button property.** Not offered, since it has no value. Chart and Rollup refuse it too, as Notion's do. CSV export leaves it out.
- **To-dos.** Can't have a Button property (§11's no extra properties).

## 7. Release order, within Buttons

1. A release with the block spec only, to set the floor (§5). Then the page button: Insert blocks, Add row, Edit rows, Open, Confirmation.
2. Button property: Edit property, plus those that apply.
3. Variables and formula values.
4. Steps that reach outside, one at a time, once the Lead has decided each.

No running cost until step 4.

## 8. Checks before release

- A tap on a phone in the Home Screen app raises no keyboard (B72's rule), and keeps the caret where it was.
- A failed step leaves no partial change, on real Postgres.
- A retry after a lost reply makes one row.
- Each row in §3's notice table, and each broken target in §4.
- A button in his Day template on a copy of his real data: new days copy it, the day draft doesn't treat it as a filled slot or an anchor (R2-6's bar), and day open stays within R2-7's bar.
- A page's export writes a button's label, so a page never silently loses a line.
