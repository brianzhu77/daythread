#if canImport(UIKit)
  import DaythreadCore
  import Testing
  import UIKit

  @testable import DaythreadEditor

  extension OnScreen {
    /// Input methods are left alone (Review Focus 3): while a line holds marked text, no key of the page's runs, no
    /// shortcut is looked for, nothing from outside changes its row, and what is composed is not yet the document.
    @MainActor
    @Suite struct InputMethodTests {
      private func compose(_ text: String, in line: LineTextView) {
        line.setMarkedText(text, selectedRange: NSRange(location: (text as NSString).length, length: 0))
      }

      /// `onComposingChange` says once when composing begins and once when it ends, after the committed words were
      /// reported; also for a composition cancelled with nothing typed, and one ended by the line losing the keyboard.
      @Test func the_screen_says_when_composing_begins_and_ends() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        var events: [String] = []
        screen.controller.onChange = { _, _ in events.append("change") }
        screen.controller.onComposingChange = { composing in
          #expect(composing == screen.controller.isComposing)
          events.append(composing ? "composing" : "done")
        }
        let line = try screen.focus(1)
        for step in ["j", "jin", "今"] { compose(step, in: line) }
        #expect(events == ["composing"])
        line.unmarkText()
        _ = screen.wait(0.2) { false }
        #expect(events == ["composing", "change", "done"])

        // Cancelled: the marked text is taken away and nothing is committed.
        events = []
        compose("a", in: line)
        line.setMarkedText("", selectedRange: NSRange(location: 0, length: 0))
        line.unmarkText()
        _ = screen.wait(0.2) { false }
        #expect(events == ["composing", "done"])
        #expect(try screen.words() == ["one", "two今"])

        // Ended by the keyboard going to another line.
        events = []
        compose("天", in: line)
        try screen.line(0).becomeFirstResponder()
        _ = screen.wait(0.2) { false }
        #expect(events == ["composing", "change", "done"])
        #expect(try screen.words() == ["one", "two今天"])
      }

      @Test func marked_text_is_not_the_document() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        let before = screen.controller.document
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(1)
        for step in ["j", "jin", "今", "今天"] { compose(step, in: line) }
        #expect(screen.controller.isComposing)
        #expect(line.text == "two今天")
        #expect(screen.controller.document == before)
        #expect(reports == 0)
      }

      @Test func return_while_marked_only_commits() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(1)
        compose("今天", in: line)
        line.insertText("\n")
        _ = screen.list
        #expect(line.markedTextRange == nil)
        #expect(!screen.controller.isComposing)
        #expect(screen.controller.itemCount == 2, "the line was split")
        #expect(try screen.words() == ["one", "two今天"])
        #expect(line.isFirstResponder)
        #expect(reports == 1)

        // By the delegate's path too: the key is not the page's while text is marked.
        compose("买菜", in: line)
        let end = NSRange(location: (line.text as NSString).length, length: 0)
        #expect(line.delegate?.textView?(line, shouldChangeTextIn: end, replacementText: "\n") == false)
        #expect(screen.controller.itemCount == 2)
        #expect(line.markedTextRange != nil)
        #expect(reports == 1)
      }

      @Test func backspace_while_marked_only_edits_the_marked_text() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        let before = screen.controller.document
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        // At the start of the line, where Backspace with nothing marked would join it to the line above.
        let line = try screen.focus(1, at: 0)
        line.setMarkedText("ab", selectedRange: NSRange(location: 2, length: 0))
        line.deleteBackward()
        _ = screen.list
        #expect(screen.controller.itemCount == 2, "the line was joined")
        #expect(try screen.line(0).text == "one")
        #expect(line.text.hasSuffix("two") && line.text.count < "abtwo".count, "the marked text is \(line.text)")
        #expect(screen.controller.document == before)
        #expect(reports == 0)
      }

      @Test func a_tab_while_marked_does_nothing() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        let before = screen.controller.document
        let line = try screen.focus(1)
        compose("今", in: line)
        try screen.press(line, "\t")
        line.insertText("\t")
        #expect(line.markedTextRange != nil)
        #expect(line.text == "two今")
        #expect(screen.controller.document == before)
      }

      @Test func no_shortcut_is_looked_for_while_marked() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: ""), block("b", "paragraph", text: "two")])
        let before = screen.controller.document
        let cell = try screen.cell(0)
        let line = try screen.focus(0)
        compose("# ", in: line)
        _ = screen.list
        #expect(screen.controller.document == before)
        #expect(try screen.cell(0) === cell)
        #expect(screen.controller.redrawnRows.isEmpty)
        #expect(line.accessibilityTraits.contains(.header) == false)

        // Committed at once, the two characters are words, not the shortcut typed one key at a time.
        line.unmarkText()
        #expect(try screen.blocks()[0].type == "paragraph")
        #expect(try screen.words()[0] == "# ")
      }

      @Test func committing_reads_the_line_once() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "")])
        var reports: [String] = []
        screen.controller.onChange = { document, _ in reports.append(document) }
        let line = try screen.focus(0)
        for step in ["j", "jin", "今", "今天"] { compose(step, in: line) }
        line.unmarkText()
        #expect(reports.count == 1)
        #expect(InlineContent(Document.blocks(try #require(reports.last))[0].content).plain == "今天")
        for step in ["m", "mai", "买", "买菜"] { compose(step, in: line) }
        line.unmarkText()
        _ = screen.wait(0.2) { false }
        #expect(reports.count == 2)
        #expect(InlineContent(Document.blocks(try #require(reports.last))[0].content).plain == "今天买菜")
        #expect(line.text == "今天买菜")
        #expect(!screen.controller.isComposing)
      }

      @Test func an_outside_change_to_the_composing_row_waits_until_composition_ends() throws {
        let workspace = try makeWorkspace()
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        var reports: [String] = []
        screen.controller.onChange = { document, _ in reports.append(document) }
        let cell = try screen.cell(1)
        let line = try screen.focus(1)
        compose("今天", in: line)
        let marked = line.markedTextRange.map { line.offset(from: line.beginningOfDocument, to: $0.start) }

        // Elsewhere the row became a bullet.
        let outside = Document.write([block("a", "paragraph", text: "one"), block("b", "bulletListItem", text: "two")])
        screen.controller.replace(document: outside, in: workspace)
        _ = screen.list
        #expect(line.text == "two今天")
        #expect(line.markedTextRange.map { line.offset(from: line.beginningOfDocument, to: $0.start) } == marked)
        #expect(line.markedTextRange != nil)
        #expect(try screen.cell(1) === cell, "the composing row was rebuilt")
        #expect(!screen.controller.redrawnRows.contains("b"), "the composing row was redrawn")
        #expect(line.isFirstResponder)
        #expect(reports.isEmpty)

        line.unmarkText()
        _ = screen.list
        let after = try screen.blocks()
        #expect(after.map(\.type) == ["paragraph", "bulletListItem"], "the outside change was not applied")
        #expect(try screen.words() == ["one", "two今天"], "his words once, and the server's kind")
        #expect(reports.count == 1)
        #expect(reports.last == screen.controller.document)
        #expect(try screen.line(1).text == "two今天")
        #expect(try screen.line(1).isFirstResponder)
        #expect(!screen.controller.isComposing)
      }

      @Test func an_outside_change_to_another_row_is_applied_during_composition() throws {
        let workspace = try makeWorkspace()
        let screen = try Screen.editing([
          block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two"),
          block("c", "paragraph", text: "three"),
        ])
        var reports: [String] = []
        screen.controller.onChange = { document, _ in reports.append(document) }
        let line = try screen.focus(1)
        compose("今天", in: line)

        let outside = Document.write([
          block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two"),
          block("c", "paragraph", text: "three, changed elsewhere"),
        ])
        screen.controller.replace(document: outside, in: workspace)
        _ = screen.list
        #expect(try screen.line(2).text == "three, changed elsewhere", "the other row waited")
        #expect(screen.controller.redrawnRows == ["c"])
        #expect(line.text == "two今天")
        #expect(line.markedTextRange != nil)
        #expect(reports.isEmpty)

        line.unmarkText()
        _ = screen.list
        #expect(try screen.words() == ["one", "two今天", "three, changed elsewhere"])
        #expect(reports.count == 1)
      }

      /// The server's page no longer has the row he is composing in: the row stays while he composes, and his words go
      /// back in when the composition ends, as the merge puts back a line deleted on the server and changed by him.
      @Test func an_outside_change_that_removes_the_composing_row_gives_his_words_back_when_it_ends() throws {
        let workspace = try makeWorkspace()
        let screen = try Screen.editing([
          block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two"),
          block("c", "paragraph", text: "three"),
        ])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(1)
        compose("今天", in: line)

        let outside = Document.write([block("a", "paragraph", text: "one"), block("c", "paragraph", text: "three")])
        screen.controller.replace(document: outside, in: workspace)
        _ = screen.list
        #expect(screen.controller.itemCount == 3)
        #expect(try screen.line(1) === line)
        #expect(line.markedTextRange != nil && line.isFirstResponder)
        #expect(line.text == "two今天")

        line.unmarkText()
        _ = screen.list
        #expect(try screen.words() == ["one", "two今天", "three"])
        #expect(reports == 1)
      }

      /// The server changed the words of the row he composed in: the server's words stay there and his go into a new
      /// row below (the merge's rule). The caret follows his words, after what he committed, and the keyboard stays.
      @Test func the_caret_follows_his_words_when_the_merge_puts_them_below_the_servers() throws {
        let screen = try Screen.editing([
          block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two"),
          block("c", "paragraph", text: "three"),
        ])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(1)
        let watch = KeyboardWatch(screen)
        compose("今天", in: line)
        let outside = Document.write([
          block("a", "paragraph", text: "one"), block("b", "paragraph", text: "TWO"),
          block("c", "paragraph", text: "three"),
        ])
        screen.controller.replace(document: outside, in: try makeWorkspace())
        line.unmarkText()
        _ = screen.list

        #expect(try screen.words() == ["one", "TWO", "two今天", "three"])
        let his = try screen.line(2)
        #expect(his.isFirstResponder, "the caret stayed in the server's line")
        #expect(his.selectedRange == NSRange(location: 5, length: 0))
        #expect(reports == 1)
        _ = screen.wait(0.5) { false }
        #expect(watch.droppedWhileTyping == 0, "the keyboard went down")
        // His next character goes after his words, not into the server's.
        his.insertText("!")
        #expect(try screen.words() == ["one", "TWO", "two今天!", "three"])
      }

      /// The server deleted the to-do he composed in: his words come back as a plain line, which takes the caret and
      /// the keyboard.
      @Test func the_caret_follows_his_words_when_the_server_deleted_the_to_do_he_composed_in() throws {
        let screen = try Screen.editing([
          block("a", "paragraph", text: "one"),
          block("t", "task", ["taskId": .string("editor-task:t"), "role": .string("plan"), "planDate": .string("")], text: "Call"),
          block("c", "paragraph", text: "three"),
        ])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(1)
        let watch = KeyboardWatch(screen)
        compose("今", in: line)
        let outside = Document.write([block("a", "paragraph", text: "one"), block("c", "paragraph", text: "three")])
        screen.controller.replace(document: outside, in: try makeWorkspace())
        line.unmarkText()
        _ = screen.list

        #expect(try screen.words() == ["one", "Call今", "three"])
        #expect(try screen.blocks()[1].type == "paragraph")
        let his = try screen.line(1)
        #expect(his.isFirstResponder, "the caret was lost")
        #expect(his.selectedRange == NSRange(location: 5, length: 0))
        #expect(reports == 1)
        _ = screen.wait(0.5) { false }
        #expect(watch.droppedWhileTyping == 0, "the keyboard went down")
      }

      /// A composition that ends because the keyboard is being put away (swiped down, the host ending editing, a tap
      /// elsewhere) is merged and drawn, and the keyboard stays away: nothing takes it back for his words.
      @Test(arguments: ["server changed his row", "server deleted his to-do"])
      func a_composition_ended_by_putting_the_keyboard_away_keeps_it_away(_ outsideChange: String) throws {
        let todo = outsideChange == "server deleted his to-do"
        let middle =
          todo
          ? block("b", "task", ["taskId": .string("editor-task:b"), "role": .string("plan"), "planDate": .string("")], text: "two")
          : block("b", "paragraph", text: "two")
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), middle, block("c", "paragraph", text: "three")])
        var reports = 0
        var ended = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        screen.controller.onComposingChange = { if !$0 { ended += 1 } }
        let line = try screen.focus(1)
        let watch = KeyboardWatch(screen)
        compose("今天", in: line)
        let outside =
          todo
          ? Document.write([block("a", "paragraph", text: "one"), block("c", "paragraph", text: "three")])
          : Document.write([
            block("a", "paragraph", text: "one"), block("b", "paragraph", text: "TWO"),
            block("c", "paragraph", text: "three"),
          ])
        screen.controller.replace(document: outside, in: try makeWorkspace())

        line.resignFirstResponder()
        _ = screen.wait(0.5) { false }

        #expect(try screen.words() == (todo ? ["one", "two今天", "three"] : ["one", "TWO", "two今天", "three"]))
        #expect(screen.controller.itemCount == (todo ? 3 : 4))
        #expect(!screen.holdsKeyboard, "the keyboard was taken back")
        #expect(watch.droppedWhileTyping == 1)
        #expect(reports == 1)
        #expect(ended == 1)
      }

      /// Another page while composing, with a change from outside held: his words are reported for the page he wrote
      /// them in, and nothing takes the keyboard for that page.
      @Test func another_page_while_a_change_is_held_reports_his_words_and_takes_no_keyboard() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        var reports: [String] = []
        screen.controller.onChange = { document, _ in reports.append(document) }
        let line = try screen.focus(1)
        compose("今天", in: line)
        screen.controller.replace(
          document: Document.write([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "TWO")]),
          in: try makeWorkspace())
        let next = try makePage([block("x", "paragraph", text: "other")], id: "q")
        screen.controller.edit(page: next, in: try makeWorkspace())
        _ = screen.wait(0.3) { false }

        #expect(reports.count == 1)
        let reported = Document.blocks(try #require(reports.first)).map { InlineContent($0.content).plain }
        #expect(reported == ["one", "TWO", "two今天"])
        #expect(screen.controller.document == next.document)
        #expect(!screen.holdsKeyboard, "the keyboard was taken for the old page")
      }

      /// A merge that leaves no row holding his words, while his row is gone: the keyboard is given up before the row
      /// leaves the list, rather than taken away with it.
      @Test func a_merge_that_leaves_no_row_for_his_words_gives_the_keyboard_up_first() throws {
        let screen = try Screen.editing([
          block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two"),
          block("c", "paragraph", text: "three"),
        ])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        // No merge the app makes drops his words; this stands in for one that did.
        let without = Document.write([block("a", "paragraph", text: "one"), block("c", "paragraph", text: "three")])
        screen.controller.mergeAfterComposing = { _, _, _ in without }
        let line = try screen.focus(1)
        compose("今天", in: line)
        screen.controller.replace(document: without, in: try makeWorkspace())
        line.unmarkText()
        _ = screen.wait(0.3) { false }

        #expect(try screen.words() == ["one", "three"])
        #expect(screen.controller.itemCount == 2)
        #expect(!screen.holdsKeyboard)
        #expect(reports == 1)
      }

      /// Two changes from outside in one composition: the merge starts from the page before the first, and keeps both.
      @Test func two_outside_changes_during_one_composition_are_both_kept() throws {
        let workspace = try makeWorkspace()
        let screen = try Screen.editing([
          block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two"),
          block("c", "paragraph", text: "three"),
        ])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(1)
        compose("今天", in: line)
        screen.controller.replace(
          document: Document.write([
            block("a", "paragraph", text: "one"), block("b", "bulletListItem", text: "two"),
            block("c", "paragraph", text: "three, later"),
          ]), in: workspace)
        screen.controller.replace(
          document: Document.write([
            block("a", "paragraph", text: "one, later"), block("b", "bulletListItem", text: "two"),
            block("c", "paragraph", text: "three, later"),
          ]), in: workspace)
        #expect(try screen.line(0).text == "one, later")
        #expect(line.markedTextRange != nil)
        line.unmarkText()
        _ = screen.list
        #expect(try screen.words() == ["one, later", "two今天", "three, later"])
        #expect(try screen.blocks()[1].type == "bulletListItem")
        #expect(reports == 1)
      }

      /// Another page while composing, and a cell given to another row: each ends the composition once, after its
      /// words were reported.
      @Test(arguments: ["another page", "rebound cell"])
      func a_composition_ended_from_outside_says_so_once(by way: String) throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        var events: [String] = []
        screen.controller.onChange = { _, _ in events.append("change") }
        screen.controller.onComposingChange = { events.append($0 ? "composing" : "done") }
        let line = try screen.focus(1)
        compose("今", in: line)
        if way == "another page" {
          screen.controller.edit(
            page: try makePage([block("x", "paragraph", text: "other")], id: "q"), in: try makeWorkspace())
        } else {
          rebind(try #require(try screen.cell(1) as? TextBlockCell), to: "a", showing: "one")
        }
        _ = screen.wait(0.2) { false }
        #expect(events == ["composing", "change", "done"])
        #expect(!screen.controller.isComposing)
      }

      @Test func composing_on_an_empty_new_line_stays_on_that_line() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        try screen.focus(0).insertText("\n")
        _ = screen.list
        let fresh = try #require(screen.controller.focusedLine)
        #expect(try screen.line(1) === fresh)
        for step in ["j", "今", "今天"] { compose(step, in: fresh) }
        _ = screen.list
        #expect(screen.controller.focusedLine === fresh)
        #expect(fresh.text == "今天")
        #expect(try screen.line(0).text == "one")
        fresh.unmarkText()
        _ = screen.list
        #expect(try screen.words() == ["one", "今天", "two"])
        #expect(screen.controller.focusedLine === fresh)
        #expect(fresh.selectedRange == NSRange(location: 2, length: 0))
      }

      /// A composing line that loses the keyboard (he taps another line) commits what it composed, once.
      @Test func a_composing_line_that_loses_the_keyboard_commits_once() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        var reports: [String] = []
        screen.controller.onChange = { document, _ in reports.append(document) }
        let line = try screen.focus(1)
        compose("今天", in: line)
        line.resignFirstResponder()
        _ = screen.wait(0.2) { false }
        #expect(!screen.controller.isComposing)
        #expect(try screen.words() == ["one", "two今天"])
        #expect(reports.count == 1)

        // Nothing is held any more: a change from outside is drawn at once.
        let outside = Document.write([block("a", "paragraph", text: "one, elsewhere"), block("b", "paragraph", text: "two今天")])
        screen.controller.replace(document: outside, in: try makeWorkspace())
        _ = screen.list
        #expect(try screen.line(0).text == "one, elsewhere")
      }

      /// A cell given to another row first reads what its line composed into the row it was composed in.
      @Test func a_cell_given_to_another_row_commits_its_marked_text_into_the_old_row() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        var reports: [String] = []
        screen.controller.onChange = { document, _ in reports.append(document) }
        let cell = try #require(try screen.cell(1) as? TextBlockCell)
        let line = try screen.focus(1)
        compose("今天", in: line)

        rebind(cell, to: "a", showing: "one")
        #expect(try screen.words() == ["one", "two今天"])
        #expect(reports.count == 1)
        #expect(!screen.controller.isComposing)
        #expect(!line.isFirstResponder)
        #expect(line.markedTextRange == nil)
      }

      /// A change deferred to the run loop's next turn for one row never lands in the row the cell is given next,
      /// even one with the same words.
      @Test func a_cell_given_to_another_row_drops_its_deferred_change() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "two"), block("b", "paragraph", text: "two")])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let cell = try #require(try screen.cell(1) as? TextBlockCell)
        let line = try screen.focus(1)
        let end = NSRange(location: 3, length: 0)
        #expect(line.delegate?.textView?(line, shouldChangeTextIn: end, replacementText: " x\ny") == false)

        rebind(cell, to: "a", showing: "two")
        _ = screen.wait(0.3) { false }
        #expect(line.text == "two", "the deferred change landed in the row the cell was given")
        #expect(try screen.words() == ["two", "two"])
        #expect(reports == 0)
      }

      // MARK: The resign path

      private var withHisRow: [Block] {
        [block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two"), block("c", "paragraph", text: "three")]
      }

      /// The server changed the words of the row he composes in, so the merge puts his words in a row of their own.
      private var serverChangedHisRow: String {
        Document.write([
          block("a", "paragraph", text: "one"), block("b", "paragraph", text: "TWO"), block("c", "paragraph", text: "three"),
        ])
      }

      /// A cell given to another row while its line composes over a held change: the commit goes as the keyboard goes,
      /// so nothing takes the keyboard back for his words, and the merged page is drawn once the line has let it go.
      @Test func a_composing_cell_with_a_held_change_given_to_another_row_takes_no_keyboard() throws {
        let screen = try Screen.editing(withHisRow)
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let cell = try #require(try screen.cell(1) as? TextBlockCell)
        let line = try screen.focus(1)
        compose("今天", in: line)
        screen.controller.replace(document: serverChangedHisRow, in: try makeWorkspace())

        rebind(cell, to: "a", showing: "one")
        _ = screen.wait(0.3) { false }

        #expect(!screen.holdsKeyboard, "a line took the keyboard inside the cell's reuse")
        #expect(try screen.words() == ["one", "TWO", "two今天", "three"])
        #expect(screen.controller.itemCount == 4)
        #expect(reports == 1)
        #expect(!screen.controller.isComposing)
      }

      /// A resign the line refuses ends the composition, and the line keeps the keyboard: the caret follows his words,
      /// as it does for a line that keeps the keyboard.
      @Test func a_resign_the_line_refuses_keeps_the_keyboard_and_the_caret_follows_his_words() throws {
        let screen = try Screen.editing(withHisRow)
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(1)
        let refusing = RefusesOneResign(try #require(line.delegate as? LineTextViewDelegate))
        line.delegate = refusing
        compose("今天", in: line)
        screen.controller.replace(document: serverChangedHisRow, in: try makeWorkspace())

        #expect(line.resignFirstResponder() == false)
        _ = screen.list

        #expect(try screen.words() == ["one", "TWO", "two今天", "three"])
        let his = try screen.line(2)
        #expect(his.isFirstResponder, "the caret stayed in the server's line")
        #expect(his.selectedRange == NSRange(location: 5, length: 0))
        #expect(reports == 1)
        #expect(!screen.controller.isComposing)
      }

      /// A change from outside that arrives while the line's resign is under way, before the merge it committed is
      /// drawn: the page is drawn once, after the resign, with the newer workspace.
      @Test func a_change_from_outside_during_a_resign_is_drawn_after_it_and_not_undone() throws {
        let blocks = withHisRow + [block("t", "task", ["taskId": .string("k")], text: "Call")]
        let screen = try Screen.editing(blocks, tasks: [taskJSON("k", status: "open")])
        let done = try makeWorkspace(tasks: [taskJSON("k", status: "done")])
        let line = try screen.focus(1)
        compose("今天", in: line)
        screen.controller.replace(
          document: Document.write(
            [block("a", "paragraph", text: "one"), block("b", "paragraph", text: "TWO"), block("c", "paragraph", text: "three")]
              + [block("t", "task", ["taskId": .string("k")], text: "Call")]),
          in: try makeWorkspace(tasks: [taskJSON("k", status: "open")]))
        // The host answers his words with the page as it now has it, in which the to-do was ticked.
        var answered = false
        screen.controller.onChange = { document, _ in
          guard !answered else { return }
          answered = true
          screen.controller.replace(document: document, in: done)
        }

        line.resignFirstResponder()
        _ = screen.wait(0.3) { false }

        #expect(answered)
        #expect(try screen.words() == ["one", "TWO", "two今天", "three", "Call"])
        let todo = try #require(try screen.cell(4) as? TodoBlockCell)
        #expect(todo.symbolName == "checkmark.circle.fill", "the older workspace was drawn back")
        #expect(!screen.holdsKeyboard)
      }

      /// What the list does to a cell it gives to another row.
      private func rebind(_ cell: TextBlockCell, to row: String, showing words: String) {
        cell.configure(
          style: .paragraph, depth: 0, text: AttributedString(words), editable: true, rowID: row,
          delegate: cell.line.delegate as? LineTextViewDelegate)
        cell.layoutIfNeeded()
      }
    }
  }

  /// The screen's delegate of a line, which refuses the line's first resign (as a delegate may, through
  /// `textViewShouldEndEditing`) and passes everything else on.
  @MainActor
  private final class RefusesOneResign: NSObject, LineTextViewDelegate {
    private let screen: LineTextViewDelegate
    private var refusals = 1

    init(_ screen: LineTextViewDelegate) {
      self.screen = screen
    }

    func textViewShouldEndEditing(_ textView: UITextView) -> Bool {
      guard refusals > 0 else { return true }
      refusals -= 1
      return false
    }

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
      screen.textView?(textView, shouldChangeTextIn: range, replacementText: text) ?? true
    }

    func textViewDidChange(_ textView: UITextView) { screen.textViewDidChange?(textView) }
    func textViewDidBeginEditing(_ textView: UITextView) { screen.textViewDidBeginEditing?(textView) }
    func textViewDidChangeSelection(_ textView: UITextView) { screen.textViewDidChangeSelection?(textView) }
    func textViewDidEndEditing(_ textView: UITextView) { screen.textViewDidEndEditing?(textView) }
    func lineTextView(_ line: LineTextView, didPress key: EditablePage.Key) -> Bool {
      screen.lineTextView(line, didPress: key)
    }
    func lineTextViewMarkedTextDidChange(_ line: LineTextView) { screen.lineTextViewMarkedTextDidChange(line) }
    func lineTextViewDidGiveUpKeyboard(_ line: LineTextView) { screen.lineTextViewDidGiveUpKeyboard(line) }
    func lineTextViewKeptKeyboard(_ line: LineTextView) { screen.lineTextViewKeptKeyboard(line) }
    func lineTextView(_ line: LineTextView, canMoveCaret direction: LineTextView.Direction) -> Bool {
      screen.lineTextView(line, canMoveCaret: direction)
    }
    func lineTextView(_ line: LineTextView, moveCaret direction: LineTextView.Direction, near point: CGPoint) {
      screen.lineTextView(line, moveCaret: direction, near: point)
    }
  }
#endif
