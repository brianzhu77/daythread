#if canImport(UIKit)
  import DaythreadCore
  import Testing
  import UIKit

  @testable import DaythreadEditor

  /// A page being edited, in a window, as he sees it.
  @MainActor
  private struct Screen {
    let window: UIWindow
    let controller: DocumentViewController

    var list: UICollectionView {
      let list = controller.view as! UICollectionView
      list.layoutIfNeeded()
      return list
    }

    func cell(_ item: Int) throws -> UICollectionViewCell {
      try #require(list.cellForItem(at: IndexPath(item: item, section: 0)))
    }

    /// The text view that holds a row's words.
    func line(_ item: Int) throws -> LineTextView {
      try #require((try cell(item) as? LineBlockCell)?.line, "row \(item) has no text view")
    }

    /// Lets the run loop turn until `condition` holds, for what the system does after a turn (the keyboard, an
    /// animated scroll). Synchronous, so no other test runs on the main actor meanwhile.
    func wait(_ seconds: TimeInterval = 5, until condition: () -> Bool) -> Bool {
      let end = Date().addingTimeInterval(seconds)
      while !condition(), Date() < end { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
      return condition()
    }
  }

  @MainActor
  @Suite struct EditingTests {
    private func editing(
      _ blocks: [Block], tasks: [JSONValue] = [], width: CGFloat = 390, safeArea: CGFloat = 0,
      category: UIContentSizeCategory = .large
    ) throws -> Screen {
      let controller = DocumentViewController()
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 844))
      window.traitOverrides.preferredContentSizeCategory = category
      window.rootViewController = controller
      window.makeKeyAndVisible()
      controller.additionalSafeAreaInsets = UIEdgeInsets(top: 0, left: safeArea, bottom: 0, right: safeArea)
      controller.view.layoutIfNeeded()
      controller.edit(page: try makePage(blocks), in: try makeWorkspace(tasks: tasks))
      return Screen(window: window, controller: controller)
    }

    /// Puts the caret in a row's line at `offset` (its end when nil).
    private func focus(_ screen: Screen, _ item: Int, at offset: Int? = nil) throws -> LineTextView {
      let line = try screen.line(item)
      #expect(line.becomeFirstResponder())
      line.selectedRange = NSRange(location: offset ?? (line.text as NSString).length, length: 0)
      return line
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
      #expect(line.accessibilityValue == "two!")

      // A to-do's words are typed the same way, and its circle is named by them.
      let todo = try focus(screen, 2)
      todo.insertText("?")
      #expect(reports.count == 2)
      #expect(InlineContent(Document.blocks(try #require(reports.last?.document))[2].content).plain == "three?")
      #expect((try screen.cell(2) as? TodoBlockCell)?.circle.accessibilityLabel == "Complete three?")
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
      for item in [0, 3] {
        let line = try screen.line(item)
        let landed = try hit(item)
        #expect(landed === line, "a tap in row \(item) lands on \(landed.map { "\(type(of: $0))" } ?? "nothing")")
        #expect(line.isEditable)
        #expect(line.becomeFirstResponder())
        #expect(line.isFirstResponder)
      }
      // In the row's margin beside the words, too.
      #expect(try hit(0, at: 4) === (try screen.line(0)))
      for item in [1, 2] {
        let landed = try hit(item)
        let isLine = landed.map { $0 is UITextView || $0.superview is UITextView } ?? false
        #expect(!isLine, "row \(item) takes a caret")
        #expect(landed?.canBecomeFirstResponder != true)
      }
      // The circle is still the circle's.
      let circle = try #require((try screen.cell(3) as? TodoBlockCell)?.circle)
      let centre = circle.convert(CGPoint(x: circle.bounds.midX, y: circle.bounds.midY), to: screen.window)
      #expect(screen.window.hitTest(centre, with: nil).map { $0 === circle || $0.isDescendant(of: circle) } == true)

      // A page that is only shown takes no caret.
      screen.controller.show(page: try makePage([block("a", "paragraph", text: "Words to tap")]), in: try makeWorkspace())
      let shown = try hit(0)
      #expect(!(shown is UITextView), "a shown page's line takes a caret")
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

      // Typing goes on from there into the new page.
      line.insertText("Z")
      #expect(reports == 1)
      #expect(InlineContent(try blocks(of: screen.controller.document)[1].content).plain == "tZ words, more")
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
        ], tasks: [taskJSON("k", status: "open")], width: width, safeArea: safeArea, category: category)
      let list = screen.list
      let visible = list.bounds.inset(by: list.safeAreaInsets)
      for item in 0..<3 {
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
      let line = try focus(screen, lowest)
      defer { line.resignFirstResponder() }
      let guide = list.keyboardLayoutGuide
      let up = screen.wait {
        screen.window.layoutIfNeeded()
        return list.convert(guide.layoutFrame, to: screen.window).height > 100
      }
      try #require(up, "no software keyboard came up")
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

    private func allSubviews(_ view: UIView) -> [UIView] {
      view.subviews + view.subviews.flatMap { allSubviews($0) }
    }
  }
#endif
