# Comments: design

- Author: Bumblebee (Product) · 2026-11-05 · status: **step 1 of §6 approved to build (Lead 479f3f9d, Roadbuster; Jazz looks at the pane), with Ratchet's design read done.** Step 1 live 2026-11-05 (#150). **Steps 2 to 4 ready for the Lead to read; step 2 to be approved after Chart's first PR (Lead 9d5b3c33).**
- Asked by the Lead (4a1712e6: a later item in `databases.md` §14, not Not planned; d34dd413: group 1). Nothing is cut for lack of evidence, and Brian's use only sets the order (Brian 57deaed7).
- **Evidence:** Notion's page on [comments, mentions and reminders](https://www.notion.com/help/comments-mentions-and-reminders), read through a fetch and summary, not tried in a real Notion. Marked "Notion" below where it comes from there. Everything else is my proposal. Brian has made no request for comments, and how anyone would use them with one person in a workspace is an untested assumption: a note to oneself on a line, without changing the line.

## 1. What it is here

A workspace holds one person, so a comment is a note attached to something, kept out of the words. That changes what's worth building from Notion's page:

| Notion's page says | Here |
| --- | --- |
| On a page, a block, selected text, a database row or a property | The same, in the order of §6 |
| ⋮⋮ → Comment, the selected text's menu, a row's menus, cmd/ctrl + shift + M | The same, where those menus exist. At 390 from the same menus and the `⋯` |
| Replies, edit, delete, resolve, reopen | The same |
| A pane from 💬: click to see where a comment sits, filter open or resolved, newest reply first | The same, with no filter by person |
| Comments shown at the side by default, or icons only ("Minimal") | **Icons only, with no setting.** Brian's look is minimal (1ac6784b), and a side column would change the width of Brian's days |
| Mentions, Inbox, red unread circle, email and push | **Waits for shared pages (Lead 3f167c20).** Each needs a second person in a workspace, which isn't a judgement on its merit |
| Reactions on a comment or on text | **Waits for shared pages (Lead 3f167c20):** a reaction is a signal to someone else |
| Attachments | The page doesn't cover them. Not in this design |

## 2. What Brian sees

- **Nothing, until there's a comment.** A page with none looks exactly as it does today, pixel for pixel: no icon in the head, no margin, no hover marker on lines.
- **Adding:**
  - Selected text: `Comment` in its bar.
  - A block: `Comment` in the handle's menu, including an image, a file, a table or a card. A chosen block's bar has it too.
  - A page or a row page: `Comment` in the head's `⋯`.
  - A row: from its row page's `⋯`, including in a peek. **Corrected (Roadbuster ad27a337, Bumblebee):** a view has no row menu to put it in, as a table row only has Open, and comments don't justify adding one. A row menu would be its own decision. Notion's page has one, so this is a known difference.
  - ⌘⇧M at 1280 does the first that applies: selected text, then the block at the caret, then the page.
- **Writing:** a small field at the place at 1280, a sheet at 390 that clears the keyboard. Enter on a phone makes a new line and the button sends. At 1280 ⌘Enter sends and Esc cancels, keeping the draft if there are words.
- **Seeing:**
  - A commented line has a small mark in the margin at 1280. At 390 there's no margin, so it sits at the line's end.
  - Selected text keeps a light grey underline. Grey, because Brian's look is black, white and grey (116a40ab).
  - A page or row comment shows a count in the head, which opens the pane.
  - Resolved threads leave no mark.
- **The pane:** at the side at 1280, a sheet at 390. Threads with the newest reply first, Open by default, Resolved one tap away. A thread shows the words it's on, its comments with their times, and Reply. Tapping it goes to the place. It has no author name or avatar, as there's one person.
- **Actions on a comment:** Edit and Delete. **On a thread:** Resolve and Reopen. Deleting and resolving have the usual notice with Undo. **Adding and editing take no Undo slot (Bumblebee, after Roadbuster ad27a337):** they have no notice, so taking the one slot would silently cost the Undo of whatever came before, such as a table just deleted. A comment added by mistake can be deleted, and an edit edited again. Deleting the last comment removes its thread; deleting the first keeps the replies (Roadbuster). The count in the head is open threads only. Going to another page closes the pane. A draft survives a reload until it's sent or cancelled, as a phone can discard a tab that's in the background.

## 3. Where a comment is stored (for Roadbuster, the main choice)

**I'd keep comments out of the page's document entirely (Lead leans yes, 3f167c20; Roadbuster agrees, 6d11ad9d):** in a table of their own, not page rows as synced records are, because a floor build reads page rows and might show an unknown type, but never touches a table it doesn't know. Each thread holds its page, the block id if any, and the quoted words with their place in the line. The mark and underline are drawn over the document, not written in it.

- **Why:** the document stays byte for byte what it was. So Brian's days don't change, the floor build can't damage a comment by saving over a mark it doesn't know (the B87 condition), a comment causes no document save or conflict, and export, search, the day draft and the sweep don't have to learn a new mark.
- **The cost:** the underline has to find its words each time. It checks the quoted words at their stored place in the line and never searches for them elsewhere, so a repeated phrase can't get underlined in the wrong spot. If the words there no longer match, the thread falls back to the whole line, and the pane keeps the words as they were quoted (Ratchet 858117fa). A mark in the document would follow edits exactly, so this is less precise. I think that's the right trade for a note-to-self.
- **Alternative:** an inline mark in the document, as Notion's behaviour suggests. More exact, but it needs every build from the floor up to keep an unknown mark, and it writes to the document on every comment. I wouldn't start there.
- **Loading (Roadbuster):** with the workspace. A person's notes should stay far under the 10 MB ceiling (Lead 6934c378), and loading per page would add a fetch to every page for no gain yet. Usage reads report their bytes alongside the workspace's size.

**Contract for step 1 (Ratchet 858117fa).** A workspace save from an older tab or build never replaces or touches this table. Each thread has its own version, and Edit, Delete, Resolve and their Undo send it, so a late Undo can't erase a newer reply: it reads "Can't undo · edited since", today's rule. Tested with two tabs and a second account, across read, write, search, export and Undo.

## 4. What happens to it

- **A line moved:** the thread follows it, using the block id and B29's move identity. Cut and paste the same way.
- **A line deleted:** the thread stays in the pane, reading "Line removed" with its quoted words. Undo of the delete brings the mark back.
- **A line copied, a page or row duplicated, a template used:** the copy has no comments. A new day never brings a comment from a template.
- **A synced block:** a comment on a line in a synced block belongs to the shared record, and shows on every copy, as its words do. Please check this reads sensibly in the page that isn't the one it was made on. A line has a different id in each place, so the thread holds the record's line id (Roadbuster). The rules are below. **Step 2 ships without them (Lead 836135d4):** Comment isn't offered inside a synced block, and the shared thread is built after selected words. **An accepted difference until then:** comment on an ordinary line, Sync it, place it on another page and remove the original place, and the thread and its words stay in the pane but read "Line removed" rather than following the shared line. It's stated in the release note.
- **A thread on a synced line, proposed (Bumblebee, after Ratchet 858117fa, on `synced-blocks.md` §4):** it also stores its home, the page it was made on.
  - **Shown:** on every page holding a place, in the pane and as a mark.
  - **Unsync here, or deleting a copy:** the thread stays with the shared lines. That place's lines are ordinary now and carry no thread, as any copy doesn't.
  - **Unsync all, deleting the original, or Unsync as the only place, so the sharing ends:** the thread moves to its one line in the home page if that line can still be identified, otherwise to the first remaining place in page order, otherwise the home page's pane. After Unsync here, the home page's old mapping may be gone (Ratchet dcd7619a). Other places get no copy of it.
  - **Deleting the last place:** "Line removed" in its home page's pane, as for any line.
  - **A place's page in Trash:** the others go on showing it. If every place is in Trash, it goes with them, and comes back with the first restored.
  - **Undo of any of these:** one Undo moves the thread's anchor back to the shared line, with the sync's own rule: "Can't undo · edited since" if a place changed. It never restores an old copy of the replies (Ratchet dcd7619a). Step 2's checks include: unsync the home, edit and reply, end the sharing elsewhere, then Undo.
  - **Search and export:** export writes it once, under its home page, or the first remaining place. Search opens the home place if it's live, otherwise the first live place, otherwise the home page's pane.
- **A page or row in Trash:** its threads go with it and come back with it, and go for good with it. Moving a row to another database keeps them.
- **Search:** finds a comment's words and opens the thread. Resolved ones too, marked as resolved.
- **The day draft:** sends the model no comments. They're notes about a line rather than the day's words, and sending them would widen what the model sees.
- **Export:** a `Comments` part at the end of the page's Markdown, with each thread's quoted words, comments, times and whether it's resolved. Nothing is left out. §3 spares export a new mark, not this: it has to read the table (Roadbuster).
- **Offline or failed:** the words stay in the field with "Not saved · Retry", as anywhere else.
- **An older tab:** knows nothing of them, shows no mark, and can't harm them, given §3.
- **Another account can never read one.** Each query carries the owner, as Files' do.

## 5. Limits

2,000 characters a comment, as a starting number for Roadbuster to check against the ceiling. The refusal says so, with the words kept.

## 6. Release order, within this

1. Comments on a page or row, with the pane, Edit, Delete, Resolve and Reopen. This settles storage, Undo and export with nothing drawn on a line.
2. On a block, with the margin mark and ⌘⇧M. A move, delete, Undo and synced block come with it.
3. On selected text, with the underline and its fallback.
4. On a property of a row, as Notion's page has it: `Comment` on the property in a row page and in a table cell's menu. Last, as I expect it's the least used. That's a guess, and it sets order only.

## 7. Open for review

- **Decided (Lead 3f167c20):** reactions wait for shared pages, and margin marks only, with no comments at the side (§1). **Lead, still open:** no count of comments in Pages or the sidebar.
- **Jazz:** where the margin mark sits on a To-do line and in a section with hidden empty rows (B19). The underline in both themes. **Settled (Jazz a9dd4697, replacing my "only one should be open"):** at 1100 px and wider the pane and a peek stay open side by side, as the peek's row is what the note is about. Below that the pane lies over them, and Esc closes the pane first, then the peek.
- **Roadbuster:** §3's storage, how a command for a comment gets its one Undo, and whether Linked from or Search needs anything new.
- **Ratchet:** the anchor falling back when words change, a thread on a moved or trashed line, owner checks, and a synced block's thread.

## 8. Success read

Counted only, in usage reads, by reading the table: nothing to build for it. Threads made per week, by kind (page, block, text), and how many get resolved. If nobody makes any after release, that's a reason to stop at the first step of §6 rather than a reason to remove it (57deaed7).
