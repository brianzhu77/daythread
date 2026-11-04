# CSV export, CSV import and pasting TSV: design

- Author: Bumblebee (Product) · 2026-11-03 · status: **design for Lead and Roadbuster to review**. Not approved and not built. Task #289, checklist R4-7, R4-8, R4-9, whose rows hold the acceptance bar and the Notion sources. This doc adds only what they leave open.
- **Evidence:** Notion's [export][e] and [import][i] pages, as read for those rows. Excel's and Numbers' behaviour below is from what I know and **needs one real file from each,** as no test has run. I read our code on main.

## 1. Recommended order

**Export, then TSV, then import.** Export has no way to harm anything, and it reuses the app's download. TSV's the smaller form of import's conversion. Import has the most ways to fail, and it reuses both.

## 2. Export (R4-7)

- **Where:** `⋯` on a view → Export → **This view** or **Whole database**, and a switch **Include page bodies**, off by default. With it on, it's a zip of the CSV and a Markdown file per row, using `pageMarkdown`.
- **The download:** reuse `account-row.tsx:54`'s path. Whether a file saves from the Home Screen app is the row's "or says why not", so it needs a native check.
- **Excel and Chinese:** write a **UTF-8 BOM**. Without one, Excel on Windows is known to read UTF-8 as the system's encoding, and Chinese text turns to garbage. It's harmless elsewhere, and our import strips it.

| Type | Written as |
| --- | --- |
| Date | ISO, and a range as `start → end`, as our import reads back |
| Checkbox | `Yes` / `No` |
| Multi-select, Relation | Names joined with `, `. **A comma in a name can't be told apart in that list,** and §4 handles it on the way in |
| Formula, Rollup | The value shown |
| Created and Edited time, ID | As shown |
| Files | As R3-11 |

**Formula-looking text:** a text value starting `=`, `+`, `-`, `@`, tab or return gets a leading `'`. A Number column is written plain, so `-5` stays a number. Our import reads `'=` back as `=`, so nothing changes on a round trip through the app. A spreadsheet will show the `'` on such a value, which is the cost of not running it.

## 3. Pasting TSV (R4-9)

Today's handler (`database-block.tsx:878`) already splits lines. A selected cell takes the grid. While a cell's being edited, it stays text in that cell.

- **Parsing:** spreadsheets quote a cell holding a newline or tab, so a plain split on lines is wrong. Share the CSV parser, with tab as the delimiter.
- **Which cells:** the view's visible columns and rows, in the order shown, from the selected cell. A hidden column is skipped and isn't filled. **This is what it looks like it does,** and it's the same reason "All" leaves out hidden rows (R3-26).
- **More rows than remain:** new rows, with the values that keep them in sight (§7.4), or the existing notice. **More columns than remain:** dropped and counted. It doesn't make properties, as import's the place for that.
- **The notice:** "12 cells pasted · 2 couldn't convert · 1 read-only · Undo".
- **Limit:** past 1,000 cells, say so and paste nothing, unless Roadbuster's measure says otherwise.

## 4. Import (R4-8)

The file is **read and parsed in the browser,** so the preview costs the server nothing and nothing's sent until confirmation.

**Reading:** strict UTF-8 first, and on failure `TextDecoder('gb18030')`, which browsers include. The preview shows the text, so a wrong guess is visible before writing. Delimiter: comma, or semicolon (European Excel) and tab if they fit the file better.

**The preview:** one sheet at both widths: each column with its first values, its suggested type or matched property, and a count of cells that don't fit.

| Column's values | Suggested |
| --- | --- |
| All numbers | Number |
| All ISO or MM/DD/YYYY dates | Date |
| All yes/no or true/false | Checkbox |
| Few distinct values | Select. **Multi-select only if chosen by hand,** because a comma may be part of a name |
| Anything else | Text |

**DD/MM/YYYY is never guessed:** `03/04/2026` reads as MM/DD as the row says. If a column holds a value like `25/04/2026`, the whole column stays text and is counted. Half a column in the wrong month would be silent damage.

**Writing:** one command with one Undo, as the row says. Status has no type to suggest, so a merge maps to it by name.

## 5. The limit is the real unknown

R4-8 asks for up to 10,000 rows as one change with one Undo. **That's a single command through the Worker and Postgres, plus whatever `operations` records to undo it.** I don't know that this fits, and **Roadbuster measures it before building the preview (Lead c3eb70ca).** If it doesn't fit, the limit drops and the single Undo stays:

- **First choice:** state a lower limit and refuse clearly above it, as the row allows.
- **Not acceptable:** splitting into batches that break "one Undo", or a partial import that stops midway and leaves some rows.

**Measured (Roadbuster f4d4ebd1):** 10,000 rows and 5 columns as one command fits: 640 ms on `wrangler dev` with local Postgres, and Undo works. But every command reads the whole workspace, so an ordinary save afterwards goes from 2 ms to about 100 ms. With Node's heap capped at 100 MB as a stand-in for the Worker's 128 MB, two imports worked and the third ran out of memory, and on the Worker that would likely stop the app loading. So R4-8 has **a workspace size limit as well as the row limit, about 10 MB (Lead 6934c378).** A deployed run confirms the ceiling if Roadbuster can get one. Brian's pages and tasks were 106 KB on Nov 3, after 13 days of day pages, about 8 KB a day, which is about 3 years to 10 MB at that rate. That's a small sample.

## 6. Open

- **Roadbuster:** §5's measure on the Worker. And the paste limit in §3.
- **Lead:** `'` on formula-looking text is the row's rule. It does show in a spreadsheet, and I accept that for safety.
- **Needs real files:** one CSV each from Excel on Windows (Chinese system) and Numbers, with Chinese text and a comma in a value.

[e]: https://www.notion.com/help/export-your-content
[i]: https://www.notion.com/help/import-data-into-notion
