#if canImport(UIKit)
  import DaythreadCore
  import Testing
  import UIKit

  @testable import DaythreadEditor

  extension OnScreen {
    /// The keys of the spec's §10.3 on a page being edited, driven through the text view's own input calls.
    @MainActor
    @Suite struct KeyTests {
      private func todo(_ id: String, _ text: String?) -> Block {
        Block(
          id: id, type: "task",
          props: [
            "taskId": .string("editor-task:\(id)"), "role": .string("plan"), "planDate": .string("2026-10-22"),
          ],
          content: .array(text.map { [run($0)] } ?? []))
      }


      @Test func return_splits_the_line_and_the_caret_is_at_the_start_of_the_new_line() throws {
        let screen = try Screen.editing([
          block("a", "paragraph", ["textColor": .string("red")], text: "onetwo"), block("b", "paragraph", text: "next"),
        ])
        var reports: [(document: String, singleDeleteIds: [String])] = []
        screen.controller.onChange = { reports.append(($0, $1)) }
        let line = try screen.focus(0, at: 3)
        let watch = KeyboardWatch(screen)

        line.insertText("\n")
        _ = screen.list

        let blocks = try screen.blocks()
        #expect(try screen.words() == ["one", "two", "next"])
        #expect(blocks[0].id == "a" && blocks[0].props["textColor"] == .string("red"), "the first half is the line")
        #expect(!["a", "b"].contains(blocks[1].id) && blocks[1].type == "paragraph")
        #expect(reports.count == 1)
        #expect(reports.first?.document == screen.controller.document)
        #expect(reports.first?.singleDeleteIds == [])
        #expect(try screen.line(0).text == "one")
        let next = try screen.line(1)
        #expect(next.rowID == blocks[1].id)
        #expect(next.text == "two")
        #expect(next.isFirstResponder, "the new line has the keyboard")
        #expect(next.selectedRange == NSRange(location: 0, length: 0))
        _ = screen.wait(0.5) { false }
        #expect(watch.droppedWhileTyping == 0, "the keyboard went down")
      }

      /// The keyboard's own path: a software keyboard's Return and Tab reach the line as text to insert, and the
      /// delegate is asked first.
      @Test func return_and_tab_by_the_delegates_path_are_the_pages_keys() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "twothree")])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(1, at: 3)
        #expect(line.delegate?.textView?(line, shouldChangeTextIn: NSRange(location: 3, length: 0), replacementText: "\n") == false)
        _ = screen.list
        #expect(try screen.words() == ["one", "two", "three"])
        let next = try #require(screen.controller.focusedLine)
        #expect(next.rowID == (try screen.blocks()[2].id) && next.selectedRange == NSRange(location: 0, length: 0))

        #expect(next.delegate?.textView?(next, shouldChangeTextIn: NSRange(location: 0, length: 0), replacementText: "\t") == false)
        _ = screen.list
        #expect(try screen.blocks().map(\.id) == ["a", "b"])
        #expect(try screen.blocks()[1].children.count == 1, "Tab did not nest the line")
        #expect(screen.controller.focusedLine?.text == "three")
        #expect(reports == 2)
      }

      /// Return over a selection on screen: the selected words go and the line splits there.
      @Test func return_over_a_selection_replaces_it_and_splits() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one, two")])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(0)
        line.selectedRange = NSRange(location: 3, length: 2)
        line.insertText("\n")
        _ = screen.list
        #expect(try screen.words() == ["one", "two"])
        #expect(try screen.line(1).isFirstResponder)
        #expect(try screen.line(1).selectedRange == NSRange(location: 0, length: 0))
        #expect(reports == 1)
      }

      /// Pasted words still waiting for the run loop's next turn when a key comes: they go in first, and the key acts
      /// after them.
      @Test func words_pasted_just_before_return_go_in_before_the_split() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(0)
        #expect(line.delegate?.textView?(line, shouldChangeTextIn: NSRange(location: 3, length: 0), replacementText: " x\ny") == false)
        line.insertText("\n")
        _ = screen.wait(0.3) { false }
        #expect(try screen.words() == ["one x y", "", "two"])
        #expect(try screen.line(1).isFirstResponder)
        #expect(try screen.line(1).text == "")
        #expect(reports == 1)
      }

      /// A restructure that holds the keyboard (a row rebuilt as a to-do) does not move the list.
      @Test func holding_the_keyboard_does_not_scroll_the_list() throws {
        let screen = try Screen.editing((0..<60).map { block("p\($0)", "paragraph", text: "Line \($0)") })
        let list = screen.list
        list.setContentOffset(CGPoint(x: 0, y: list.contentSize.height - list.bounds.height), animated: false)
        list.layoutIfNeeded()
        let item = try #require(list.indexPathsForVisibleItems.map(\.item).sorted().dropLast(2).last)
        let line = try screen.focus(item, at: 0)
        for character in "[]" { line.insertText(String(character)) }
        _ = screen.wait(1) { false }
        let before = list.contentOffset
        line.insertText(" ")
        _ = screen.wait(0.5) { false }
        #expect(try screen.blocks()[item].type == "task")
        #expect(screen.controller.focusedLine?.rowID == "p\(item)")
        #expect(abs(list.contentOffset.y - before.y) <= 0.5, "the list moved from \(before.y) to \(list.contentOffset.y)")
      }

      /// At a soft wrap one offset is two places: the end of the first visual line (the tokenizer's line end, carrying
      /// a backward affinity, as End puts it) and the start of the second. The caret is on the line it is drawn on: at
      /// the first, Down stays in the row of two lines and Up leaves it; at the second, the other way round.
      @Test func at_a_soft_wrap_the_caret_is_on_the_line_it_is_drawn_on() throws {
        let long = "Words long enough to wrap onto a second line on a phone, and that is all"
        let screen = try Screen.editing([
          block("a", "paragraph", text: "one"), block("b", "paragraph", text: long), block("c", "paragraph", text: "end"),
        ])
        let line = try screen.focus(1, at: 0)
        let lineEnd = try #require(
          line.tokenizer.position(from: line.beginningOfDocument, toBoundary: .line, inDirection: .storage(.forward)))
        let offset = line.offset(from: line.beginningOfDocument, to: lineEnd)
        #expect(offset < (long as NSString).length, "the row does not wrap")
        let secondLine = try #require(line.tokenizer.position(from: lineEnd, toBoundary: .line, inDirection: .storage(.forward)))
        #expect(line.offset(from: line.beginningOfDocument, to: secondLine) == (long as NSString).length, "more than two lines")

        line.selectedTextRange = line.textRange(from: lineEnd, to: lineEnd)
        let drawn = line.caretRect(for: try #require(line.selectedTextRange).start)
        #expect(abs(drawn.midY - line.caretRect(for: line.beginningOfDocument).midY) < 1, "not drawn on the first line")
        #expect(try !screen.takesKey(line, UIKeyCommand.inputDownArrow), "Down left a row of two lines from its first")
        #expect(try screen.takesKey(line, UIKeyCommand.inputUpArrow))

        line.selectedRange = NSRange(location: offset, length: 0)
        #expect(try screen.takesKey(line, UIKeyCommand.inputDownArrow))
        #expect(try !screen.takesKey(line, UIKeyCommand.inputUpArrow))
      }

      @Test func return_in_a_to_do_makes_a_new_circle() throws {
        let screen = try Screen.editing([todo("t", "Call mum")])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        try screen.focus(0, at: 4).insertText("\n")
        _ = screen.list

        let blocks = try screen.blocks()
        #expect(try screen.words() == ["Call", " mum"])
        #expect(blocks.map(\.type) == ["task", "task"])
        #expect(blocks[0].props["taskId"] == .string("editor-task:t"), "the row keeps its to-do")
        #expect(blocks[1].props["taskId"] == .string("editor-task:\(blocks[1].id)"), "the new row has its own")
        #expect(blocks[1].props["role"] == .string("plan") && blocks[1].props["planDate"] == .string("2026-10-22"))
        let cell = try #require(try screen.cell(1) as? TodoBlockCell, "the new row has no circle")
        #expect(cell.symbolName == "circle")
        #expect(cell.line.isFirstResponder)
        #expect(cell.line.selectedRange == NSRange(location: 0, length: 0))
        #expect(reports == 1)
      }

      @Test func backspace_at_the_start_joins_the_line_above_and_the_caret_is_at_the_joining_point() throws {
        let screen = try Screen.editing([
          block("a", "bulletListItem", text: "one"), block("b", "paragraph", text: "two"),
          block("c", "paragraph", text: "three"),
        ])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(1, at: 0)
        let watch = KeyboardWatch(screen)

        line.deleteBackward()
        _ = screen.list

        #expect(try screen.words() == ["onetwo", "three"])
        #expect(try screen.blocks().map(\.id) == ["a", "c"])
        #expect(screen.controller.itemCount == 2)
        let joined = try screen.line(0)
        #expect(joined.text == "onetwo")
        #expect(joined.isFirstResponder)
        #expect(joined.selectedRange == NSRange(location: 3, length: 0))
        #expect(reports == 1)
        _ = screen.wait(0.5) { false }
        #expect(watch.droppedWhileTyping == 0, "the keyboard went down")
      }

      @Test func backspace_on_an_empty_to_do_removes_the_row_and_the_caret_is_at_the_end_of_the_line_above() throws {
        let screen = try Screen.editing([
          block("a", "paragraph", text: "one"), todo("t", nil), block("c", "paragraph", text: "three"),
        ])
        var reports: [(document: String, singleDeleteIds: [String])] = []
        screen.controller.onChange = { reports.append(($0, $1)) }
        let line = try screen.focus(1, at: 0)
        let watch = KeyboardWatch(screen)
        line.deleteBackward()
        _ = screen.list

        #expect(try screen.blocks().map(\.id) == ["a", "c"])
        let above = try screen.line(0)
        #expect(above.isFirstResponder)
        #expect(above.selectedRange == NSRange(location: 3, length: 0))
        #expect(reports.count == 1)
        #expect(reports.first?.singleDeleteIds == ["t"], "the save names the row he removed")
        _ = screen.wait(0.5) { false }
        #expect(watch.droppedWhileTyping == 0, "the keyboard went down")
      }

      /// A redraw from outside that is not about his words (a tick) leaves the save naming the row he removed one at a
      /// time, as does the merge after a composition; once the row is back in the page it is no longer named.
      @Test func a_row_removed_one_at_a_time_is_still_named_after_a_change_from_outside() throws {
        let original = [
          block("a", "paragraph", text: "one"), todo("t", nil),
          block("c", "task", ["taskId": .string("k2")], text: "three"),
        ]
        let screen = try Screen.editing(original, tasks: [taskJSON("k2", status: "open")])
        var reports: [[String]] = []
        screen.controller.onChange = { _, ids in reports.append(ids) }
        try screen.focus(1, at: 0).deleteBackward()
        #expect(reports.last == ["t"])

        let ticked = try makeWorkspace(tasks: [taskJSON("k2", status: "done")])
        screen.controller.replace(document: try #require(screen.controller.document), in: ticked)
        _ = screen.list
        try screen.focus(0).insertText("!")
        #expect(reports.last == ["t"], "the tick's redraw forgot the row he removed")

        // Composing while the page changes from outside: the merge when it ends still names the row.
        let line = try screen.focus(0)
        line.setMarkedText("今", selectedRange: NSRange(location: 1, length: 0))
        let elsewhere = Document.write([
          block("a", "paragraph", text: "one!"), block("c", "task", ["taskId": .string("k2")], text: "three, later"),
        ])
        screen.controller.replace(document: elsewhere, in: ticked)
        line.unmarkText()
        _ = screen.list
        #expect(try screen.words() == ["one!今", "three, later"])
        #expect(reports.last == ["t"], "the merge forgot the row he removed")

        // The row is back: it is no longer removed.
        screen.controller.replace(document: Document.write(original), in: ticked)
        _ = screen.list
        try screen.focus(0).insertText("?")
        #expect(reports.last == [])
      }

      @Test func tab_and_shift_tab_nest_and_unnest_and_the_caret_stays_in_its_words() throws {
        let screen = try Screen.editing([
          block("a", "paragraph", text: "one"), block("b", "bulletListItem", text: "two words"),
        ])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(1, at: 3)

        try screen.press(line, "\t")
        _ = screen.list
        #expect(try screen.blocks().map(\.id) == ["a"])
        #expect(try screen.blocks()[0].children.map(\.id) == ["b"])
        let nested = try screen.line(1)
        #expect((try screen.cell(1) as? BlockCell)?.indentationLevel == 1)
        #expect(nested.isFirstResponder)
        #expect(nested.selectedRange == NSRange(location: 3, length: 0))
        #expect(nested.text == "two words")

        try screen.press(nested, "\t", .shift)
        _ = screen.list
        #expect(try screen.blocks().map(\.id) == ["a", "b"])
        let back = try screen.line(1)
        #expect((try screen.cell(1) as? BlockCell)?.indentationLevel == 0)
        #expect(back.isFirstResponder)
        #expect(back.selectedRange == NSRange(location: 3, length: 0))
        #expect(reports == 2)
      }

      @Test func a_tab_that_does_nothing_changes_nothing() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        let before = screen.controller.document
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let snapshots = screen.controller.appliedSnapshots
        // The first line of the page has no line before it to go under, and none to come out of.
        let line = try screen.focus(0, at: 1)
        try screen.press(line, "\t")
        try screen.press(line, "\t", .shift)
        line.insertText("\t")
        _ = screen.list
        #expect(screen.controller.document == before)
        #expect(line.text == "one", "the tab went into the line")
        #expect(line.isFirstResponder && line.selectedRange == NSRange(location: 1, length: 0))
        #expect(reports == 0)
        #expect(screen.controller.appliedSnapshots == snapshots)
      }

      @Test func a_typed_shortcut_changes_the_rows_kind_and_keeps_the_caret() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "Call"), block("b", "paragraph", text: "milk")])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(0, at: 0)
        _ = screen.wait(0.5) { false }
        // The row becomes another kind of cell, and later another row: the keyboard stays up throughout.
        let watch = KeyboardWatch(screen)
        for character in "[] " { line.insertText(String(character)) }
        _ = screen.list
        #expect(try screen.blocks()[0].type == "task")
        let todo = try #require(try screen.cell(0) as? TodoBlockCell, "the row is not a to-do")
        #expect(todo.line.text == "Call")
        #expect(todo.line.isFirstResponder)
        #expect(todo.line.selectedRange == NSRange(location: 0, length: 0))

        let bullet = try screen.focus(1, at: 0)
        for character in "- " { bullet.insertText(String(character)) }
        _ = screen.list
        #expect(try screen.blocks()[1].type == "bulletListItem")
        #expect(try screen.line(1).text == "milk")
        #expect(try screen.line(1).isFirstResponder)
        #expect(try screen.line(1).selectedRange == NSRange(location: 0, length: 0))
        // One report for each character typed; the shortcut is part of the last one's.
        #expect(reports == 5)

        // `---` replaces the row with a divider, and the caret goes to a paragraph made after it.
        let third = try screen.focus(1)
        third.selectedRange = NSRange(location: 0, length: (third.text as NSString).length)
        third.deleteBackward()
        for character in "---" { try #require(screen.controller.focusedLine).insertText(String(character)) }
        _ = screen.list
        #expect(try screen.blocks().map(\.type) == ["task", "divider", "paragraph"])
        let made = try screen.line(2)
        #expect(made.isFirstResponder && made.selectedRange == NSRange(location: 0, length: 0))
        _ = screen.wait(0.5) { false }
        #expect(watch.droppedWhileTyping == 0, "the keyboard went down")
      }

      @Test func the_arrow_keys_move_from_the_last_line_of_one_row_to_the_next_row() throws {
        let long = "Words long enough to wrap onto a second line on a phone, and then a few more words"
        let screen = try Screen.editing([
          block("a", "paragraph", text: long), block("d", "divider"), block("b", "paragraph", text: "short"),
          block("c", "paragraph", text: "last"),
        ])
        let first = try screen.focus(0, at: 2)
        let up = UIKeyCommand.inputUpArrow
        let down = UIKeyCommand.inputDownArrow
        // On a row's first visual line of two, Down is the system's: it moves within the words.
        #expect(try !screen.takesKey(first, down))
        // At the page's first line, Up is the system's too.
        #expect(try !screen.takesKey(first, up))

        // From the row's last visual line Down goes to the next row that takes a caret, past the divider.
        first.selectedRange = NSRange(location: (first.text as NSString).length, length: 0)
        #expect(try screen.takesKey(first, down))
        try screen.press(first, down)
        _ = screen.list
        let short = try screen.line(2)
        #expect(short.isFirstResponder, "the caret is not in the row after the divider")
        #expect(short.selectedRange == NSRange(location: 5, length: 0), "as near the caret's place as the words go")

        // Up comes back to the last visual line of the row above, near the place it left.
        let x = short.convert(short.caretRect(for: short.endOfDocument), to: screen.list).midX
        #expect(try screen.takesKey(short, up))
        try screen.press(short, up)
        _ = screen.list
        #expect(first.isFirstResponder)
        let caret = first.caretRect(for: try #require(first.selectedTextRange).start)
        let lastLine = first.caretRect(for: first.endOfDocument)
        #expect(abs(caret.midY - lastLine.midY) < 1, "the caret is not on the row's last visual line")
        let width = first.font?.pointSize ?? 17
        #expect(abs(first.convert(caret, to: screen.list).midX - x) <= width, "the caret moved sideways")

        // At the page's last line Down is the system's.
        let last = try screen.focus(3)
        #expect(try !screen.takesKey(last, down))
        #expect(try screen.takesKey(last, up))
      }

      /// The empty space under the last row: the caret goes to the end of the last line that takes one; under a block
      /// that holds no words, a new paragraph is made for it. The day's header is not that space.
      @Test(arguments: ["paragraph", "divider", "database"])
      func a_tap_under_the_last_line_puts_the_caret_at_its_end(lastBlock: String) throws {
        var blocks = [block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")]
        if lastBlock != "paragraph" { blocks.append(block("x", lastBlock)) }
        let screen = try Screen.editing(blocks)
        let header = UILabel()
        header.text = "Thursday"
        screen.controller.headerView = header
        _ = screen.list
        var reports: [(document: String, singleDeleteIds: [String])] = []
        screen.controller.onChange = { reports.append(($0, $1)) }
        let rows = screen.controller.itemCount
        let lastRow = try screen.cell(rows - 1).frame
        #expect(!screen.controller.takesTapUnderTheLastLine(at: CGPoint(x: 100, y: lastRow.midY)))
        #expect(!screen.controller.takesTapUnderTheLastLine(at: CGPoint(x: 100, y: header.convert(header.bounds, to: screen.list).midY)))
        let below = CGPoint(x: 100, y: lastRow.maxY + 40)
        #expect(screen.controller.takesTapUnderTheLastLine(at: below))

        screen.controller.tapUnderTheLastLine(at: below)
        _ = screen.list

        if lastBlock == "paragraph" {
          #expect(reports.isEmpty)
          #expect(try screen.line(1).isFirstResponder)
          #expect(try screen.line(1).selectedRange == NSRange(location: 3, length: 0))
        } else {
          let after = try screen.blocks()
          #expect(after.map(\.id).prefix(3) == ["a", "b", "x"])
          #expect(after.count == 4)
          #expect(after.last?.type == "paragraph" && InlineContent(after.last?.content).isEmpty)
          #expect(reports.count == 1)
          #expect(screen.controller.itemCount == 4)
          let made = try screen.line(3)
          #expect(made.rowID == after.last?.id)
          #expect(made.isFirstResponder)
          #expect(made.selectedRange == NSRange(location: 0, length: 0))
        }
      }

      @Test func structure_changes_clear_the_text_views_own_undo() throws {
        let screen = try Screen.editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        let line = try screen.focus(0)
        line.insertText("x")
        // Typing within a line keeps the text view's own undo.
        #expect(screen.wait { line.undoManager?.canUndo == true }, "typing left nothing to undo")

        line.insertText("\n")
        _ = screen.list
        let next = try #require(screen.controller.focusedLine)
        #expect(next !== line)
        _ = screen.wait(0.2) { false }
        #expect(line.undoManager?.canUndo != true, "the split line's old text could be put back")
        #expect(next.undoManager?.canUndo != true, "the new line's undo is not empty")
        #expect(try screen.words() == ["onex", "", "two"])
      }
    }
  }
#endif
