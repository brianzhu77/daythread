#if canImport(UIKit)
  import DaythreadCore
  import Testing
  import UIKit

  @testable import DaythreadEditor

  /// A date chip, and the words it is drawn with on a page with no date.
  private let chipJSON: JSONValue = .object([
    "type": .string("dateMention"),
    "props": .object(["eventId": .string("e"), "date": .string("2026-10-22"), "time": .string("")]),
  ])
  private let chipWords = InlineText.plain(.array([chipJSON]), pageDate: nil)

  extension OnScreen {
    @MainActor
    @Suite struct EditingTests {
      private func editing(
        _ blocks: [Block], tasks: [JSONValue] = [], width: CGFloat = 390, safeArea: CGFloat = 0,
        category: UIContentSizeCategory = .large
      ) throws -> Screen {
        try Screen.editing(blocks, tasks: tasks, width: width, safeArea: safeArea, category: category)
      }

      /// Puts the caret in a row's line at `offset` (its end when nil).
      private func focus(_ screen: Screen, _ item: Int, at offset: Int? = nil) throws -> LineTextView {
        try screen.focus(item, at: offset)
      }

      private func blocks(of document: String?) throws -> [Block] {
        Document.blocks(try #require(document))
      }

      private func words(_ block: Block) -> [InlineContent.Item] {
        InlineContent(block.content).items
      }

      @Test func typing_in_a_line_changes_the_document_and_reports_it() throws {
        let before = [
          block("a", "paragraph", ["textColor": .string("red")], text: "one"),
          block("b", "paragraph", text: "two"),
          block("c", "task", ["taskId": .string("k")], text: "three"),
        ]
        let screen = try editing(before, tasks: [taskJSON("k", status: "open")])
        let original = try blocks(of: screen.controller.document)
        var reports: [(document: String, singleDeleteIds: [String])] = []
        screen.controller.onChange = { reports.append(($0, $1)) }

        let line = try focus(screen, 1)
        line.insertText("!")

        #expect(reports.count == 1)
        let report = try #require(reports.first)
        #expect(report.singleDeleteIds.isEmpty)
        #expect(report.document == screen.controller.document)
        let after = Document.blocks(report.document)
        #expect(after.count == 3)
        #expect(after[0] == original[0], "an untouched block is written back as it was read")
        #expect(after[2] == original[2])
        #expect(after[1].id == "b" && after[1].type == "paragraph" && after[1].props == original[1].props)
        #expect(InlineContent(after[1].content).plain == "two!")
        #expect(line.text == "two!")
        #expect(line.textLayoutManager != nil, "the words are laid out by TextKit 2")
        #expect(line.accessibilityValue == "two!")

        // A to-do's words are typed the same way, and its circle is named by them.
        let todo = try focus(screen, 2)
        todo.insertText("?")
        #expect(reports.count == 2)
        #expect(InlineContent(Document.blocks(try #require(reports.last?.document))[2].content).plain == "three?")
        #expect((try screen.cell(2) as? TodoBlockCell)?.circle.accessibilityLabel == "Complete three?")
      }

      /// Return is not a character of the line, and words that come in with line breaks come in as one line.
      @Test func a_newline_never_enters_a_line() throws {
        let screen = try editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        var reports: [String] = []
        screen.controller.onChange = { document, _ in reports.append(document) }
        // Return as a keyboard sends it, in any of its spellings, is the key: the line splits, and nothing goes in,
        // not even a space.
        _ = try focus(screen, 0)
        for (index, key) in ["\n", "\r", "\r\n"].enumerated() {
          try #require(screen.controller.focusedLine).insertText(key)
          #expect(screen.controller.itemCount == 3 + index)
        }
        #expect(try screen.words() == ["one", "", "", "", "two"])
        #expect(reports.count == 3)

        let line = try focus(screen, 0)
        line.replace(try #require(line.selectedTextRange), withText: " a\nb\r\nc")
        #expect(line.text == "one a b c")
        #expect(reports.count == 4)
        #expect(InlineContent(try blocks(of: reports.last)[0].content).plain == "one a b c")

        // Words that reach the text view by its delegate's path are made one line too.
        let range = NSRange(location: (line.text as NSString).length, length: 0)
        #expect(line.delegate?.textView?(line, shouldChangeTextIn: range, replacementText: " d\ne") == false)
        #expect(screen.wait { line.text == "one a b c d e" })
        #expect(InlineContent(try blocks(of: reports.last)[0].content).plain == "one a b c d e")
      }

      /// A software keyboard's Tab (iPad) arrives as a tab character: it is the Tab key, and a tab in pasted words is
      /// a space.
      @Test func a_tab_is_a_key_and_a_tab_in_pasted_words_is_a_space() throws {
        let screen = try editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        var reports: [String] = []
        screen.controller.onChange = { document, _ in reports.append(document) }
        try focus(screen, 1).insertText("\t")
        #expect(try screen.blocks()[0].children.map(\.id) == ["b"], "Tab nested the line")
        // Nested, the line is the first of its group: a second Tab, by the delegate's path, does nothing.
        let line = try #require(screen.controller.focusedLine)
        let end = NSRange(location: (line.text as NSString).length, length: 0)
        #expect(line.delegate?.textView?(line, shouldChangeTextIn: end, replacementText: "\t") == false)
        #expect(line.text == "two")
        #expect(reports.count == 1)

        line.replace(try #require(line.selectedTextRange), withText: " a\tb")
        #expect(line.text == "two a b")
        #expect(InlineContent(try blocks(of: reports.last)[0].children[0].content).plain == "two a b")
      }

      /// The object replacement character stands for a chip; typed, pasted or dropped it is nothing, so no chip is
      /// lost and none is written as a character.
      @Test func an_object_replacement_character_never_enters_a_line() throws {
        let screen = try editing([Block(id: "a", type: "paragraph", content: .array([run("Meet "), chipJSON, run(" ok")]))])
        let line = try focus(screen, 0)
        let marker = String(Character(Unicode.Scalar(0xFFFC)!))
        line.insertText("x" + marker + "y")
        line.selectedRange = NSRange(location: 0, length: 0)
        line.replace(try #require(line.selectedTextRange), withText: marker)
        let end = NSRange(location: (line.text as NSString).length, length: 0)
        #expect(line.delegate?.textView?(line, shouldChangeTextIn: end, replacementText: "z" + marker) == false)
        #expect(screen.wait { line.text.hasSuffix("z") })
        let items = words(try blocks(of: screen.controller.document)[0])
        #expect(items.filter { if case .token = $0 { true } else { false } }.count == 1)
        #expect(InlineContent(try blocks(of: screen.controller.document)[0].content).plain == "Meet \u{FFFC} okxyz")
      }

      /// A chip copied or cut goes to the pasteboard as its words. (Read from what `copy` would write; the shared
      /// simulator's pasteboard is not touched.)
      @Test func a_chip_is_copied_as_its_words() throws {
        let screen = try editing([Block(id: "a", type: "paragraph", content: .array([run("Meet "), chipJSON, run(" ok")]))])
        let line = try screen.line(0)
        let words = line.pasteboardWords(in: NSRange(location: 0, length: (line.text as NSString).length))
        #expect(words == "Meet " + chipWords + " ok")
        #expect(line.pasteboardWords(in: NSRange(location: 0, length: 4)) == "Meet")
      }

      @Test func typing_reconfigures_no_row() throws {
        let screen = try editing([
          block("a", "paragraph", text: "one"), block("b", "bulletListItem", text: "two"),
          block("c", "paragraph", text: "three"),
        ])
        let snapshots = screen.controller.appliedSnapshots
        let cells = try (0..<3).map { try screen.cell($0) }
        let line = try focus(screen, 1)
        for character in "and more" { line.insertText(String(character)) }
        line.deleteBackward()
        _ = screen.list

        #expect(screen.controller.appliedSnapshots == snapshots, "no snapshot is applied for a keystroke")
        for item in 0..<3 { #expect(try screen.cell(item) === cells[item], "row \(item) was rebuilt") }
        #expect(line.isFirstResponder)
        #expect(line.text == "twoand mor")
        #expect(screen.controller.redrawnRows.isEmpty)
      }

      @Test func a_line_that_grows_to_two_lines_makes_its_row_taller_and_moves_the_rows_below() throws {
        let screen = try editing([
          block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two"),
          block("c", "paragraph", text: "three"),
        ])
        let cell = try screen.cell(0)
        let rowHeight = cell.frame.height
        let below = try screen.cell(1).frame.minY
        let line = try focus(screen, 0)
        let lineHeight = line.font?.lineHeight ?? 20
        line.insertText(" and a good many more words, enough of them to run past the edge of the row")
        #expect(screen.wait { (try? screen.cell(0).frame.height) ?? 0 > rowHeight + lineHeight / 2 })

        let grown = try screen.cell(0)
        #expect(grown === cell, "the row was rebuilt")
        #expect(line.isFirstResponder)
        #expect(grown.frame.height >= rowHeight + lineHeight - 1, "from \(rowHeight) to \(grown.frame.height)")
        let moved = try screen.cell(1).frame.minY - below
        #expect(abs(moved - (grown.frame.height - rowHeight)) <= 0.5, "the row below moved \(moved)")
        // The words fit the row: nothing is cut off.
        let fitted = line.sizeThatFits(CGSize(width: line.bounds.width, height: .greatestFiniteMagnitude)).height
        #expect(fitted <= line.bounds.height + 0.5, "the words need \(fitted), the line is \(line.bounds.height)")
        #expect(line.frame.maxY <= grown.bounds.maxY + 0.5)
        #expect(screen.controller.appliedSnapshots == 1)

        line.selectedRange = NSRange(location: 3, length: (line.text as NSString).length - 3)
        line.deleteBackward()
        #expect(screen.wait { (try? screen.cell(0).frame.height) ?? 0 <= rowHeight + 0.5 }, "it shrinks back")
        #expect(try screen.cell(0) === cell)

        // Words set in the system's fallback fonts (Chinese, emoji) fit the row their label gives them too.
        line.insertText("，今天买菜然后去公园散步，看看花开了没有 🌳🌸🌼 再回家做饭，吃完饭再写一会儿日记")
        #expect(screen.wait { (try? screen.cell(0).frame.height) ?? 0 > rowHeight + lineHeight / 2 })
        _ = screen.list
        let fallback = line.sizeThatFits(CGSize(width: line.bounds.width, height: .greatestFiniteMagnitude)).height
        #expect(fallback <= line.bounds.height + 0.5, "the words need \(fallback), the line is \(line.bounds.height)")
      }

      @Test func styles_are_drawn_and_kept() throws {
        let screen = try editing([
          Block(
            id: "a", type: "paragraph",
            content: .array([run("plain "), run("bold", ["bold": .bool(true)]), run(" end")])),
          Block(
            id: "b", type: "paragraph",
            content: .array([
              run("see "),
              .object([
                "type": .string("link"), "href": .string("https://example.com"), "content": .array([run("this")]),
              ]),
            ])),
        ])
        func isBold(_ line: LineTextView, at offset: Int) -> Bool {
          let font = line.attributedText.attribute(.font, at: offset, effectiveRange: nil) as? UIFont
          return font?.fontDescriptor.symbolicTraits.contains(.traitBold) == true
        }
        let line = try focus(screen, 0, at: 8)
        #expect(isBold(line, at: 7), "a run that is bold is drawn bold")
        #expect(!isBold(line, at: 2))
        line.insertText("X")
        #expect(line.text == "plain boXld end")
        #expect(isBold(line, at: 8), "the typed character is drawn as its run")
        let first = try blocks(of: screen.controller.document)[0]
        #expect(InlineContent(first.content).items.count == 3)
        guard case .text(let bold, let raw) = words(first)[1] else {
          Issue.record("the bold run is gone")
          return
        }
        #expect(bold == "boXld")
        #expect(raw["styles"]?.objectValue?["bold"]?.boolValue == true)

        // After a link at the end of a line, typing is not the link's, and the text view says so before a key is hit.
        let link = try focus(screen, 1)
        #expect(link.typingAttributes[.foregroundColor] as? UIColor != UIColor.link)
        link.insertText("x")
        #expect(link.typingAttributes[.foregroundColor] as? UIColor != UIColor.link)
        #expect(link.attributedText.attribute(.foregroundColor, at: 8, effectiveRange: nil) as? UIColor != UIColor.link)
        let second = try blocks(of: screen.controller.document)[1]
        #expect(InlineContent(second.content).plain == "see thisx")
        guard case .link(let inside, _) = words(second)[1] else {
          Issue.record("the link is gone")
          return
        }
        #expect(inside.map { if case .text(let text, _) = $0 { text } else { "" } } == ["this"])
        // Inside a link typing is the link's.
        link.selectedRange = NSRange(location: 6, length: 0)
        #expect(link.typingAttributes[.foregroundColor] as? UIColor == UIColor.link)
      }

      @Test func a_chip_is_one_position_and_typing_beside_it_does_not_change_it() throws {
        let chip: JSONValue = .object([
          "type": .string("dateMention"),
          "props": .object(["eventId": .string("e"), "date": .string("2026-10-22"), "time": .string("")]),
        ])
        let screen = try editing([Block(id: "a", type: "paragraph", content: .array([run("Meet "), chip, run(" ok")]))])
        let line = try screen.line(0)
        #expect(line.text == "Meet \u{FFFC} ok")
        #expect(line.attributedText.attribute(.attachment, at: 5, effectiveRange: nil) is NSTextAttachment)
        #expect(line.accessibilityValue?.contains("Meet ") == true)
        #expect(line.accessibilityValue?.contains("\u{FFFC}") == false, "the chip is read by its words")

        _ = try focus(screen, 0, at: 6)
        line.insertText("X")
        line.selectedRange = NSRange(location: 5, length: 0)
        line.insertText("Y")
        let items = words(try blocks(of: screen.controller.document)[0])
        #expect(items.contains(.token(chip)), "the chip is written back as it was read")
        #expect(InlineContent(try blocks(of: screen.controller.document)[0].content).plain == "Meet Y\u{FFFC}X ok")
        #expect(line.text == "Meet Y\u{FFFC}X ok")
      }

      @Test func a_tap_puts_the_caret_in_that_line() throws {
        let screen = try editing([
          block("a", "paragraph", text: "Words to tap"), block("d", "divider"),
          Block(id: "x", type: "database"), block("b", "task", ["taskId": .string("k")], text: "A to-do"),
        ], tasks: [taskJSON("k", status: "open")])
        func hit(_ item: Int, at x: CGFloat? = nil) throws -> UIView? {
          let cell = try screen.cell(item)
          let point = CGPoint(x: x ?? cell.bounds.midX, y: cell.bounds.midY)
          return screen.window.hitTest(cell.convert(point, to: screen.window), with: nil)
        }
        /// The text view a touch on `view` reaches: the view itself or the one it is inside.
        func textView(holding view: UIView?) -> UITextView? {
          sequence(first: view, next: { $0?.superview }).lazy.compactMap { $0 as? UITextView }.first
        }
        for item in [0, 3] {
          let line = try screen.line(item)
          let landed = try hit(item)
          #expect(
            textView(holding: landed) === line,
            "a tap in row \(item) lands on \(landed.map { "\(type(of: $0))" } ?? "nothing")")
          #expect(line.isEditable)
          #expect(line.becomeFirstResponder())
          #expect(line.isFirstResponder)
        }
        // In the row's margin beside the words, too.
        #expect(textView(holding: try hit(0, at: 4)) === (try screen.line(0)))
        for item in [1, 2] {
          let landed = try hit(item)
          #expect(textView(holding: landed) == nil, "row \(item) takes a caret")
          #expect(landed?.canBecomeFirstResponder != true)
        }
        // The circle is still the circle's.
        let circle = try #require((try screen.cell(3) as? TodoBlockCell)?.circle)
        let centre = circle.convert(CGPoint(x: circle.bounds.midX, y: circle.bounds.midY), to: screen.window)
        #expect(screen.window.hitTest(centre, with: nil).map { $0 === circle || $0.isDescendant(of: circle) } == true)

        // A page that is only shown takes no caret.
        screen.controller.show(page: try makePage([block("a", "paragraph", text: "Words to tap")]), in: try makeWorkspace())
        let shown = try hit(0)
        #expect(textView(holding: shown) == nil, "a shown page's line takes a caret")
        #expect(try screen.line(0).isEditable == false)
      }

      @Test func a_page_edited_from_outside_keeps_the_caret_in_its_line() throws {
        let workspace = try makeWorkspace()
        let screen = try editing([
          block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two words"),
          block("c", "paragraph", text: "three"),
        ])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let cells = try (0..<3).map { try screen.cell($0) }
        let line = try focus(screen, 1)
        line.selectedRange = NSRange(location: 1, length: 3)

        let outside = Document.write([
          block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two words"),
          block("c", "paragraph", text: "three, changed elsewhere"),
        ])
        screen.controller.replace(document: outside, in: workspace)
        _ = screen.list

        #expect(screen.controller.redrawnRows == ["c"], "only the changed row is redrawn")
        #expect(try screen.line(2).text == "three, changed elsewhere")
        #expect(line.isFirstResponder)
        #expect(line.selectedRange == NSRange(location: 1, length: 3))
        for item in 0..<3 { #expect(try screen.cell(item) === cells[item]) }
        #expect(screen.controller.document == outside)
        #expect(reports == 0, "a change from outside is not his")

        // A change to the line holding the caret keeps the caret where it was in its words.
        let changedHere = Document.write([
          block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two words, more"),
          block("c", "paragraph", text: "three, changed elsewhere"),
        ])
        screen.controller.replace(document: changedHere, in: workspace)
        _ = screen.list
        #expect(line.isFirstResponder)
        #expect(line.text == "two words, more")
        #expect(line.selectedRange == NSRange(location: 1, length: 3))

        // Typing goes on from there into the new page: the selected "wo " is replaced.
        line.insertText("Z")
        #expect(reports == 1)
        #expect(InlineContent(try blocks(of: screen.controller.document)[1].content).plain == "tZwords, more")
        #expect(InlineContent(try blocks(of: screen.controller.document)[2].content).plain == "three, changed elsewhere")
      }

      /// A tick is drawn as a change from outside: the line being typed keeps its caret.
      @Test func a_tick_while_typing_in_a_to_do_keeps_its_caret() throws {
        let page = [block("a", "task", ["taskId": .string("k")], text: "Water the plants")]
        let screen = try editing(page, tasks: [taskJSON("k", status: "open")])
        let line = try focus(screen, 0, at: 5)
        var ticked: [String] = []
        screen.controller.onTick = { taskId in
          ticked.append(taskId)
          screen.controller.replace(
            document: screen.controller.document ?? "", in: try! makeWorkspace(tasks: [taskJSON("k", status: "done")]))
        }
        let cell = try #require(try screen.cell(0) as? TodoBlockCell)
        cell.circle.sendActions(for: .primaryActionTriggered)
        _ = screen.list
        #expect(ticked == ["k"])
        #expect(cell.symbolName == "checkmark.circle.fill")
        #expect(line.isFirstResponder, "the tick took the caret")
        #expect(line.selectedRange == NSRange(location: 5, length: 0))
        let struck = line.attributedText.attribute(.strikethroughStyle, at: 0, effectiveRange: nil) as? Int
        #expect(struck == NSUnderlineStyle.single.rawValue, "a done to-do's words are struck through")
        #expect(line.attributedText.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor == .secondaryLabel)
      }

      @Test(arguments: [
        (390, 0, UIContentSizeCategory.accessibilityExtraExtraExtraLarge),
        (844, 62, UIContentSizeCategory.large), (844, 62, UIContentSizeCategory.accessibilityExtraExtraExtraLarge),
      ] as [(CGFloat, CGFloat, UIContentSizeCategory)])
      func the_largest_text_size_and_landscape_keep_the_words_clear_of_the_bullet_and_the_circle(
        width: CGFloat, safeArea: CGFloat, category: UIContentSizeCategory
      ) throws {
        let long = "Words long enough to wrap onto a second line at any of these sizes, and then some more"
        let screen = try editing(
          [
            block("a", "bulletListItem", text: long), block("b", "task", ["taskId": .string("k")], text: long),
            block("c", "numberedListItem", text: "Short"),
            block("d", "bulletListItem", text: "今天买菜然后去公园散步，看看花开了没有 🌳🌸🌼 再回家做饭，吃完饭再写一会儿日记"),
          ], tasks: [taskJSON("k", status: "open")], width: width, safeArea: safeArea, category: category)
        let list = screen.list
        let visible = list.bounds.inset(by: list.safeAreaInsets)
        for item in 0..<4 {
          list.scrollToItem(at: IndexPath(item: item, section: 0), at: .top, animated: false)
          list.layoutIfNeeded()
          let cell = try screen.cell(item)
          cell.layoutIfNeeded()
          let line = try screen.line(item)
          let words = line.convert(line.bounds, to: list)
          let marker: CGRect
          if let todo = cell as? TodoBlockCell, let glyph = todo.circle.imageView {
            marker = glyph.convert(glyph.bounds, to: list)
          } else {
            let image = try #require(
              allSubviews(cell).compactMap { $0 as? UIImageView }.first { !$0.isHidden && $0.image != nil })
            marker = image.convert(image.bounds, to: list)
          }
          #expect(marker.maxX <= words.minX, "row \(item): the marker ends at \(marker.maxX), the words start at \(words.minX)")
          #expect(words.minX >= visible.minX && words.maxX <= visible.maxX + 0.5, "row \(item) leaves the safe area")
          let fitted = line.sizeThatFits(CGSize(width: line.bounds.width, height: .greatestFiniteMagnitude)).height
          #expect(fitted <= line.bounds.height + 0.5, "row \(item): the words need \(fitted), have \(line.bounds.height)")
          #expect(line.frame.maxY <= cell.bounds.maxY + 0.5 && line.frame.minY >= -0.5, "row \(item) overflows its cell")
        }
      }

      @Test func the_line_being_typed_is_not_under_the_keyboard() throws {
        let screen = try editing((0..<40).map { block("p\($0)", "paragraph", text: "Line \($0)") })
        let list = screen.list
        // The lowest row that is on screen before the keyboard comes up.
        let lowest = try #require(
          list.indexPathsForVisibleItems.map(\.item).sorted().last { item in
            guard let cell = list.cellForItem(at: IndexPath(item: item, section: 0)) else { return false }
            return cell.frame.maxY <= list.bounds.maxY - list.adjustedContentInset.bottom
          })
        // An input view of a known height stands for the keyboard, whatever the simulator's keyboard setting is.
        let keyboardHeight: CGFloat = 300
        let line = try screen.line(lowest)
        line.inputView = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: keyboardHeight))
        defer {
          line.resignFirstResponder()
          line.inputView = nil
        }
        _ = try focus(screen, lowest)
        let guide = list.keyboardLayoutGuide
        // The input view sits at the foot of the screen, which is taller than this window: the guide's top is the
        // input view's top.
        let inputTop = { line.inputView.map { $0.convert($0.bounds, to: nil).minY } ?? .infinity }
        let up = screen.wait {
          screen.window.layoutIfNeeded()
          return abs(list.convert(guide.layoutFrame, to: screen.window).minY - inputTop()) <= 1
            && abs((line.inputView?.bounds.height ?? 0) - keyboardHeight) <= 1
        }
        try #require(up, "the keyboard layout guide starts at \(guide.layoutFrame.minY), the input view at \(inputTop())")
        func caret() -> CGRect {
          let rect = line.caretRect(for: line.selectedTextRange?.end ?? line.endOfDocument)
          return line.convert(rect, to: screen.window)
        }
        let keyboardTop = { list.convert(guide.layoutFrame, to: screen.window).minY }
        let clear = screen.wait { caret().maxY <= keyboardTop() + 0.5 }
        #expect(clear, "the caret ends at \(caret().maxY), the keyboard starts at \(keyboardTop())")
        let shown = list.convert(list.bounds.inset(by: list.adjustedContentInset), to: screen.window)
        #expect(shown.contains(caret()), "the caret \(caret()) is outside the list's visible area \(shown)")
        #expect(list.keyboardDismissMode == .interactive)
      }

      /// Seen on the simulator: with the keyboard up, the text size made larger (Control Centre) grew the rows above
      /// the line being typed, and the line went under the keyboard until the next keystroke.
      @Test func the_line_being_typed_stays_above_the_keyboard_when_the_text_grows() throws {
        let screen = try editing((0..<40).map { block("p\($0)", "paragraph", text: "Line \($0)") })
        let list = screen.list
        let lowest = try #require(
          list.indexPathsForVisibleItems.map(\.item).sorted().last { item in
            guard let cell = list.cellForItem(at: IndexPath(item: item, section: 0)) else { return false }
            return cell.frame.maxY <= list.bounds.maxY - list.adjustedContentInset.bottom
          })
        let keyboardHeight: CGFloat = 300
        let line = try screen.line(lowest)
        line.inputView = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: keyboardHeight))
        defer {
          line.resignFirstResponder()
          line.inputView = nil
          screen.window.traitOverrides.remove(UITraitPreferredContentSizeCategory.self)
        }
        _ = try focus(screen, lowest)
        let guide = list.keyboardLayoutGuide
        func caret() -> CGRect {
          let rect = line.caretRect(for: line.selectedTextRange?.end ?? line.endOfDocument)
          return line.convert(rect, to: screen.window)
        }
        let keyboardTop = { list.convert(guide.layoutFrame, to: screen.window).minY }
        let up = screen.wait {
          screen.window.layoutIfNeeded()
          return abs((line.inputView?.bounds.height ?? 0) - keyboardHeight) <= 1 && caret().maxY <= keyboardTop() + 0.5
        }
        try #require(up, "the line above the keyboard before the text grows")

        screen.window.traitOverrides.preferredContentSizeCategory = .accessibilityExtraExtraExtraLarge
        let clear = screen.wait {
          screen.window.layoutIfNeeded()
          return caret().maxY <= keyboardTop() + 0.5
        }
        #expect(clear, "the caret ends at \(caret().maxY), the keyboard starts at \(keyboardTop())")
        let shown = list.convert(list.bounds.inset(by: list.adjustedContentInset), to: screen.window)
        #expect(shown.contains(caret()), "the caret \(caret()) is outside the list's visible area \(shown)")
      }

      // MARK: a line never speaks for another row or another page

      /// Another page while he composes: what he composed is committed into the page he composed it in, and reported
      /// for that page, before the other page is drawn; nothing of it reaches the new page.
      @Test(arguments: ["edit", "show"])
      func another_page_while_composing_commits_the_words_to_the_page_they_were_composed_in(by call: String) throws {
        let monday = try makePage([block("a", "paragraph", text: "one")], id: "day:2026-11-23")
        let tuesday = try makePage([block("a", "paragraph", text: "rest")], id: "day:2026-11-24")
        let screen = try editing([])
        screen.controller.edit(page: monday, in: try makeWorkspace())
        var reports: [String] = []
        screen.controller.onChange = { document, _ in reports.append(document) }
        let line = try focus(screen, 0)
        line.setMarkedText("今天", selectedRange: NSRange(location: 2, length: 0))
        #expect(screen.controller.isComposing)

        if call == "edit" {
          screen.controller.edit(page: tuesday, in: try makeWorkspace())
        } else {
          screen.controller.show(page: tuesday, in: try makeWorkspace())
        }
        _ = screen.list

        #expect(reports.count == 1)
        #expect(InlineContent(try blocks(of: reports.first)[0].content).plain == "one今天")
        #expect(!screen.controller.isComposing)
        #expect(try screen.line(0).text == "rest")
        #expect(try screen.line(0).markedTextRange == nil)
        if call == "edit" { #expect(screen.controller.document == tuesday.document) }
        // Typing goes on into the new page only.
        if call == "edit" {
          let next = try focus(screen, 0)
          next.insertText("!")
          #expect(InlineContent(try blocks(of: reports.last)[0].content).plain == "rest!")
        }
        #expect(reports.count == (call == "edit" ? 2 : 1))
      }

      /// Words that were to go in on the run loop's next turn are dropped when the line was changed from outside in
      /// between: they belonged to words that are no longer there.
      @Test func a_deferred_change_to_a_line_replaced_in_between_is_dropped() throws {
        let screen = try editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try focus(screen, 1)
        let end = NSRange(location: 3, length: 0)
        #expect(line.delegate?.textView?(line, shouldChangeTextIn: end, replacementText: " x\ny") == false)
        let outside = Document.write([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "changed")])
        screen.controller.replace(document: outside, in: try makeWorkspace())
        _ = screen.list
        _ = screen.wait(0.3) { false }
        #expect(line.text == "changed")
        #expect(screen.controller.document == outside)
        #expect(reports == 0)
      }

      /// A text view that still shows words the page no longer holds (a change from outside it has not drawn yet) is
      /// drawn again from the page; what it showed is not written over the page.
      @Test func a_line_shown_stale_is_redrawn_from_the_page_and_not_written() throws {
        let screen = try editing([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try focus(screen, 1)
        let outside = Document.write([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "changed")])
        screen.controller.replace(document: outside, in: try makeWorkspace())
        _ = screen.list
        // The line missed that redraw: it shows the words it was drawn with before, as the page then had them.
        line.show(NSAttributedString(string: "two", attributes: line.typingAttributes))
        line.insertText("!")
        #expect(reports == 0)
        #expect(screen.controller.document == outside)
        #expect(line.text == "changed")
        line.selectedRange = NSRange(location: 7, length: 0)
        line.insertText("?")
        #expect(reports == 1)
        #expect(InlineContent(try blocks(of: screen.controller.document)[1].content).plain == "changed?")
      }

      /// The row holding the caret scrolled far off a long page: typing then either has no line to go to (the
      /// keyboard is gone) or goes to that row. It never goes to a row the cell was given meanwhile.
      @Test func typing_after_the_caret_s_row_scrolled_away_goes_to_that_row_or_nowhere() throws {
        let screen = try editing((0..<200).map { block("p\($0)", "paragraph", text: "Line \($0)") })
        let before = try blocks(of: screen.controller.document)
        _ = try focus(screen, 0)
        let list = screen.list
        list.setContentOffset(CGPoint(x: 0, y: list.contentSize.height - list.bounds.height), animated: false)
        list.layoutIfNeeded()
        list.setContentOffset(CGPoint(x: 0, y: list.contentSize.height / 2), animated: false)
        list.layoutIfNeeded()
        let typing = allSubviews(list).compactMap { $0 as? LineTextView }.filter(\.isFirstResponder)
        #expect(typing.count <= 1)
        if let line = typing.first {
          #expect(line.rowID == "p0", "the keyboard is with \(line.rowID ?? "no row")")
          line.insertText("!")
          let after = try blocks(of: screen.controller.document)
          #expect(InlineContent(after[0].content).plain == "Line 0!")
          #expect(Array(after.dropFirst()) == Array(before.dropFirst()))
        } else {
          #expect(try blocks(of: screen.controller.document) == before)
        }
      }

      /// A change from outside that gives the caret's row another kind of cell: the new cell's line has the caret, with
      /// the selection it had.
      @Test func a_row_redrawn_as_another_kind_keeps_the_caret() throws {
        let workspace = try makeWorkspace(tasks: [taskJSON("k", status: "open")])
        let screen = try editing([block("a", "paragraph", text: "Water the plants"), block("b", "paragraph", text: "x")])
        let line = try focus(screen, 0)
        line.selectedRange = NSRange(location: 2, length: 3)
        let outside = Document.write([
          block("a", "task", ["taskId": .string("k")], text: "Water the plants"), block("b", "paragraph", text: "x"),
        ])
        screen.controller.replace(document: outside, in: workspace)
        _ = screen.list
        let cell = try #require(try screen.cell(0) as? TodoBlockCell)
        #expect(cell.line.isFirstResponder)
        #expect(cell.line.selectedRange == NSRange(location: 2, length: 3))
        #expect(screen.controller.redrawnRows == ["a"])
      }

      // MARK: chips

      /// A page that is only shown draws its words as 1a did: a chip is words among words, not an attachment.
      @Test func a_chip_on_a_shown_page_is_drawn_as_1a_drew_it() throws {
        let content: JSONValue = .array([run("Meet "), chipJSON, run(" ok")])
        let screen = try editing([])
        let workspace = try makeWorkspace()
        screen.controller.show(page: try makePage([Block(id: "a", type: "paragraph", content: content)]), in: workspace)
        let line = try screen.line(0)
        let cell = try screen.cell(0)
        let expected = InlineAttributedText.display(
          InlineAttributedText.make(content, pageDate: nil, in: workspace), textStyle: .body,
          compatibleWith: cell.traitCollection)
        #expect(line.text == expected.string)
        #expect(line.text == "Meet " + chipWords + " ok")
        var attachments = 0
        line.attributedText.enumerateAttribute(.attachment, in: NSRange(location: 0, length: line.attributedText.length)) {
          value, _, _ in if value != nil { attachments += 1 }
        }
        #expect(attachments == 0)
        let font = line.attributedText.attribute(.font, at: 0, effectiveRange: nil) as? UIFont
        #expect(font == expected.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)
      }

      /// A chip whose words are longer than the line is drawn at most as wide as the line, its words cut at the end.
      @Test func a_long_chip_fits_its_line_at_the_largest_text_size() throws {
        let title = "A page whose title runs on and on, far longer than any line on a phone could hold at this size"
        let target = try #require(
          Page(.object([
            "id": .string("doc-a"), "type": .string("document"), "date": .null, "title": .string(title),
            "document": .string("[]"),
          ])))
        let reference: JSONValue = .object([
          "type": .string("pageRef"), "props": .object(["pageId": .string("doc-a"), "refId": .string("r")]),
        ])
        let controller = DocumentViewController()
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.traitOverrides.preferredContentSizeCategory = .accessibilityExtraExtraExtraLarge
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.layoutIfNeeded()
        controller.edit(
          page: try makePage([Block(id: "a", type: "paragraph", content: .array([run("See "), reference]))]),
          in: try makeWorkspace(pages: [target]))
        let screen = Screen(window: window, controller: controller)
        _ = screen.list
        let line = try screen.line(0)
        line.superview?.layoutIfNeeded()
        _ = screen.list
        var widest: CGFloat = 0
        line.attributedText.enumerateAttribute(.attachment, in: NSRange(location: 0, length: line.attributedText.length)) {
          value, _, _ in widest = max(widest, (value as? NSTextAttachment)?.bounds.width ?? 0)
        }
        #expect(widest > 0, "the chip is not an attachment")
        #expect(widest <= line.bounds.width + 0.5, "the chip is \(widest) wide, the line \(line.bounds.width)")
        let fitted = line.sizeThatFits(CGSize(width: line.bounds.width, height: .greatestFiniteMagnitude)).height
        #expect(fitted <= line.bounds.height + 0.5)
      }

      // MARK: accessibility

      /// A shown page's line reads as a text view that is not edited does; an edited one as one that is.
      @Test func a_lines_traits_are_its_text_views_own_and_a_headings_header() throws {
        func reference(editable: Bool) -> UIAccessibilityTraits {
          let view = UITextView()
          view.isEditable = editable
          view.isSelectable = editable
          return view.accessibilityTraits
        }
        let blocks = [block("a", "paragraph", text: "one"), block("h", "heading", ["level": .number("2")], text: "Plan")]
        let screen = try editing(blocks)
        #expect(try screen.line(0).accessibilityTraits == reference(editable: true))
        #expect(try screen.line(1).accessibilityTraits == reference(editable: true).union(.header))
        screen.controller.show(page: try makePage(blocks), in: try makeWorkspace())
        _ = screen.list
        #expect(try screen.line(0).accessibilityTraits == reference(editable: false))
        #expect(try screen.line(1).accessibilityTraits == reference(editable: false).union(.header))
      }

      // MARK: what Task 11's review found

      /// Pasted words deferred to the run loop's next turn do not land once editing has ended: not in the line that
      /// is now only shown, and not in the page when it is edited again.
      @Test func a_deferred_change_is_dropped_when_editing_ends() throws {
        let page = try makePage([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")])
        let screen = try editing([])
        screen.controller.edit(page: page, in: try makeWorkspace())
        var reports: [String] = []
        screen.controller.onChange = { document, _ in reports.append(document) }
        let line = try focus(screen, 1)
        let end = NSRange(location: 3, length: 0)
        #expect(line.delegate?.textView?(line, shouldChangeTextIn: end, replacementText: " x\ny") == false)
        screen.controller.show(page: page, in: try makeWorkspace())
        _ = screen.wait(0.3) { false }
        #expect(try screen.line(1).text == "two")

        screen.controller.edit(page: page, in: try makeWorkspace())
        _ = screen.list
        try focus(screen, 1).insertText("!")
        #expect(try screen.words() == ["one", "two!"])
        #expect(reports.count == 1)
      }

      /// Typing after a chip at the end of a line is words, not part of the chip, before the caret has been placed.
      @Test func typing_after_a_chip_does_not_carry_the_chip() throws {
        let screen = try editing([Block(id: "a", type: "paragraph", content: .array([run("Meet "), chipJSON]))])
        let line = try screen.line(0)
        #expect(line.typingAttributes[InlineTextStorage.tokenWords] == nil)
        #expect(line.typingAttributes[.attachment] == nil)
      }

      /// Each chip is copied as its words, two the same side by side as well, and a character beside a chip is copied
      /// as itself even if it carries the chip's words.
      @Test func each_chip_is_copied_as_its_words_and_each_character_as_itself() throws {
        let screen = try editing([
          Block(id: "a", type: "paragraph", content: .array([run("Meet "), chipJSON, chipJSON, run(" ok")]))
        ])
        let line = try screen.line(0)
        let all = NSRange(location: 0, length: (line.text as NSString).length)
        #expect(line.pasteboardWords(in: all) == "Meet " + chipWords + chipWords + " ok")

        let carried = NSMutableAttributedString(attributedString: line.attributedText)
        carried.append(
          NSAttributedString(string: "x", attributes: [InlineTextStorage.tokenWords: chipWords]))
        line.attributedText = carried
        let withX = NSRange(location: 0, length: carried.length)
        #expect(line.pasteboardWords(in: withX) == "Meet " + chipWords + chipWords + " okx")
      }

      /// A tab or an object replacement character followed by a combining mark is one character to Swift; it is
      /// still a tab, or still not a character of the line.
      @Test func a_tab_or_an_object_replacement_with_a_combining_mark_is_cleaned() throws {
        let screen = try editing([block("a", "paragraph", text: "one")])
        let line = try focus(screen, 0)
        let combining = Unicode.Scalar(0x0301)!
        let tab = String(String.UnicodeScalarView([Unicode.Scalar(0x09)!, combining]))
        let marker = String(String.UnicodeScalarView([Unicode.Scalar(0xFFFC)!, combining]))
        let forbidden: Set<Unicode.Scalar> = [Unicode.Scalar(0x09)!, Unicode.Scalar(0xFFFC)!]
        #expect(LineTextView.needsCleaning(tab) && LineTextView.needsCleaning(marker))
        #expect(!LineTextView.cleaned(tab + marker).unicodeScalars.contains { forbidden.contains($0) })

        line.insertText("x" + tab + "y" + marker)
        let range = NSRange(location: (line.text as NSString).length, length: 0)
        #expect(line.delegate?.textView?(line, shouldChangeTextIn: range, replacementText: "z" + tab) == false)
        #expect(screen.wait { line.text.hasPrefix("onex") && line.text.contains("z") })
        let written = try screen.words()[0]
        #expect(!written.unicodeScalars.contains { forbidden.contains($0) }, "the line holds \(written.debugDescription)")
        #expect(!line.text.unicodeScalars.contains { forbidden.contains($0) })
      }

      private func allSubviews(_ view: UIView) -> [UIView] {
        view.subviews + view.subviews.flatMap { allSubviews($0) }
      }
    }
  }
#endif
