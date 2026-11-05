# Forms: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **"Only me" approved to build with the changes below (Lead f9bab535, from Jazz's read and Ratchet's `docs/reviews/feed-dashboard-forms-ratchet.md`, 5a4b7af8, both from reading only).** Not built. Roadbuster's, after To-dos as a source, unless swapped with Feed. **The public link stays off,** and comes to Brian as one choice once its quotas are designed.
- Asked by the Lead (3f046122). Nothing is cut for lack of evidence, and his use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's help page on [forms](https://www.notion.com/help/forms), which I read but haven't used. His use: no databases at the last read (Nov 2), so the examples are illustrations.

## 1. The idea

A form is **one more layout of a view**: questions mapped to properties, where each answer adds a row. In Notion it's mainly for collecting answers from other people. Here there are two uses, and they carry very different risk:

- **Just him:** a short set of questions as a quick way to add a row on the phone ("Log a run": distance, how it felt).
- **Anyone with a link:** someone without an account answers, and a row lands in his private workspace.

**The second is the first thing in this app that lets a person who isn't signed in write anything.** That's the decision in §5.

## 2. Who can answer

| Notion | Here | Why |
| --- | --- | --- |
| Anyone at workspace with link | **Only me** (signed in), the default | A workspace here is one person |
| Anyone on the web with link | **Anyone with the link** | Second release, after §5 |
| No access | **Closed** | Says "This form is closed". The same words if it's deleted or in Trash, so a link reveals nothing |

No Respondent property, since Person and Created by aren't planned. Every public answer is anonymous. Notion's "access after submit" has no meaning here, and neither does paid-plan branding.

## 3. Building one

- **On the form itself, not a side panel (Jazz),** so what's seen is what's answered, at both widths. A tap on a question opens it in place: wording, description, Required as a switch, ↑↓ and ×. A sheet is only for adding: `+ Add question` lists properties not yet asked and "New property". The head has "12 responses" linking to Responses, the state, and Preview, which is marked and adds nothing.
- **Made from** `+ Add view` → Form, or `⋯` → Layout. `/` stays one Database item, with `form` added as an alias. **Unlike Notion, it can be built on the phone too,** since the phone is one of his two main widths.
- **It opens with one question per property,** which he removes or reorders. A new database starts with Name.
- **Each question:** its wording, Description, Required. Multiple choice shows as a list or dropdown; text as short or long answer; Multi-select and Relation have a maximum.
- **Wording stops renaming a property (decided, Lead f9bab535, Jazz's challenge; a difference from Notion, for the release note).** A new question names its new property from the wording as first typed. After that, editing the wording changes only the wording, on an existing property too, and the property's name shows quietly under the question. A rename would change every table, filter and chart from a screen about how a question reads. There's no "Sync with property name" switch.
- **What can't be a question:** read-only types (Formula, Rollup, ID, Created time, Edited time) and Button. Files only once R3-11 exists, and not on a public form until uploads have had their own decision.
- **A Relation on a public form would show his row titles to a stranger.** It's refused on "Anyone with the link", and the editor marks that question.
- **Conditional logic:** a multiple-choice answer can lead to follow-up questions. Paid-only in Notion; included here, in the last release of this feature.
- **Submit screen:** button text, confirmation title and body. "Email a copy" waits for mail (`buttons.md` §2).

## 4. Answers

- **An answer is a row,** made by `add-row`, so it fires "Row added" automations and appears in every view.
- **The first form makes a Table view named Responses,** as Notion. It's an ordinary view, so it filters, sorts, charts and exports. A Form view itself can't be exported, as Notion.
- **The form's own header** shows data, not instructions: "12 responses", and the state "Only me · Anyone with the link · Closed" with Copy link.
- **Trying it:** Preview at both widths, which doesn't add a row.

**Answering is a page, not a sheet (Jazz),** one column up to 560 px at both widths. No asterisks: a missing answer is marked with its field's border and "Needs an answer", and the page scrolls to the first. On a phone, 16 px fields 44 px tall, the right keyboard for numbers and dates, Return to the next field, choices as rows up to about 6 and a dropdown beyond, and Send above the keyboard. Needs a native check.

**While answering:**

| State | He or they see |
| --- | --- |
| A required answer is missing | The question is marked; the answers stay |
| Failed or offline | "Not sent · Try again", and every answer stays on the screen |
| Double tap or retry | One row, by an id made when the form opened |
| Typing during a send (Ratchet) | A send holds its answers and key, and a lost reply retries that same payload. New words stay as an unsent draft, and a late success doesn't clear them. Send another gets a fresh key |
| A question was removed while open | Sends the others |
| A required one was added while open | Asks for it, losing no answers |
| Sent | The confirmation, and "Send another" on Only me |

## 5. The public link, for the Lead

**Decided (Lead b9af4ec7):** "Only me" first. The public link waits until the rest of Forms is out and Ratchet has reviewed its design. Before it's turned on, even for his account alone, the Lead asks Brian, because it's the first way a stranger can write into his workspace. The limits below are the bar.

Today every write needs a signed-in session, and the app is invite-only. A public form adds **an endpoint that writes into a private workspace with no session.** It should be very narrow:

- It takes only a form's unguessable id and answers to that form's questions. It returns only the form's questions, and never rows or other data.
- It's refused if the form isn't "Anyone with the link".
- **Stored as plain values,** with lengths capped. CSV export escapes what looks like a formula (R4-7). Links in answers aren't fetched.
- **Limits:** per form and per address, with a daily cap. Reaching the cap closes the form and says so on his side, so a flood can't fill his workspace. "Delete responses since…" with one Undo is the way to clean up.
- **Bots:** a hidden field first, and a check such as Cloudflare Turnstile if needed. I recall that being free, but I haven't checked it.
- **The public page** has no app shell, no search indexing and no signs of whose workspace it is, beyond his own wording.
- **Reset link** replaces the id, so an old link stops at once.

**Other people's answers are personal data in his workspace.** They go with his export and account deletion, and they must stay out of usage reads and logs, including request bodies and error reports. **The promise is narrowed after Ratchet's review:** the day draft model never reads a database's rows, but an answer Brian or his own rule copies onto a day is then text on that day, and the app won't track where it came from. I own the usage reads and will leave these rows out by database, counting them only.

**Ratchet's review (`docs/reviews/public-forms-ratchet.md`): the public link stays off until these hold; the Lead accepted them (ab07ea28).** Design only, nothing deployed. Only-me Forms isn't affected.

1. **A stranger's answer does no more than add its row.** The server builds the row from the published questions. On a public submission, Row added automations and default-template effects don't run, which is narrower than §4 and Only me. A visitor can never name a database, property, template or action. If Brian wants a rule to run later, that's a separate decision with its own limits.
2. **Limits are numbers, enforced in one shared place.** My starting point, for Roadbuster to measure on the Worker: 200 accepted answers a day per form, 500 across the workspace, 20 an hour per address, and 64 KB an answer, all inside the existing size ceiling. They count accepted rows, and exactly the remaining number can commit under a race. Bad or oversized requests are refused before the workspace loads. If the count can't be read, submitting is refused. Reset link doesn't reset the count, and Brian can reopen a form that hit its cap.
3. **Retry and Reset link are one contract.** A submission's key belongs to that form and that version of its link, and is bound to its answers: the same key with different answers is refused, and a retry gets only a plain "received". Publication, link version and questions are checked in the same transaction as the row, so nothing from an old link commits after a reset.
4. **The public page reads only an allowlist,** rebuilt from the current state on every request: wording, question type, Required, and option names. A question that has become a Relation, Files or read-only stops being offered, and a form in a trashed database is closed. Closed, deleted and nonexistent all look the same to a visitor.
5. **Tests before Brian is asked,** as the review lists them: the race at the last slot, Reset during a held submission, a question changed during a held submission, and a copied answer reaching a day.

6. **Added by Ratchet's second read (5a4b7af8):** accepted answers bound what's stored, not the cost of unlimited reads, bad posts or new retry keys, so read and attempt limits and how long replay keys are kept are chosen ahead of loading a workspace. And since Row added rules are live, the public path's bar on them is enforced on the trusted command path rather than by a flag from the page, as is never inheriting a default template, Button step or scheduled action.

**Running cost:** none expected beyond Worker and database use, but abuse could raise both, which is what the cap is for.

**Then:** on for Brian's account only at first, as the day draft model was, and for invitees if it holds up.

## 6. For Roadbuster and Jazz

- **Storage:** `layout` gains `form`, plus form settings on the view. An older tab should draw it as a table and keep the fields. To be run at release.
- **Jazz:** the look of the form at both widths, and whether the public page should share the app's type. Black, white and grey.
- **Roadbuster:** the endpoint in §5 and how limits are kept on the Worker.

## 7. Release order, within Forms

1. Only me: questions, Required, submit screen, Responses.
2. Conditional logic, and Files once R3-11 allows it, on Only me.
3. Anyone with the link, last, after §5's review and Brian's yes.

## 8. Checks before release

- One answer makes one row with the right values for each type, including Chinese typed with Pinyin in the Home Screen app.
- A late success after more typing keeps the new words, and a question renamed or removed, or newly required, loses no answers.
- Editing a question's wording leaves the property's name, and every view, unchanged.
- Answers survive failure and offline.
- A closed, deleted and never-existing form read the same.
- **Public link, on real Postgres, by the reviewer:** no way to read rows, another form's questions or another workspace; a wrong type or an extra field is refused; limits and cap work; reset stops the old link.
- An older tab keeps `layout` and the form's settings, with a rollback run.
- A copy of his real data: his days don't change (R1-18).
