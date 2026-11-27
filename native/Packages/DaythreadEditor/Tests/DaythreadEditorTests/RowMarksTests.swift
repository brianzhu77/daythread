#if canImport(UIKit)
  import DaythreadCore
  import Testing
  import UIKit

  @testable import DaythreadEditor

  /// The day these tests are drawn on: a Thursday.
  private let today = "2026-11-26"

  /// A to-do as the server sends it, with the dates the marks are read from.
  private func todo(
    _ id: String, title: String = "A to-do", status: String = "open", deadlineOn: String? = nil,
    createdOn: String? = nil
  ) -> JSONValue {
    var object = JSONObject()
    object["id"] = .string(id)
    object["title"] = .string(title)
    object["status"] = .string(status)
    object["paused"] = .bool(false)
    object["deadlineOn"] = deadlineOn.map { .string($0) } ?? .null
    object["attentionOn"] = .null
    if let createdOn { object["createdOn"] = .string(createdOn) }
    return .object(object)
  }

  /// A row of `taskId` on today's page: a plan row for today unless said otherwise.
  private func row(_ id: String, _ taskId: String?, _ words: String, role: String = "plan", planDate: String? = today)
    -> Block
  {
    var props = JSONObject()
    if let taskId { props["taskId"] = .string(taskId) }
    props["role"] = .string(role)
    if let planDate { props["planDate"] = .string(planDate) }
    return block(id, "task", props, text: words)
  }

  private func weekly(_ taskId: String) -> JSONValue {
    var object = JSONObject()
    object["id"] = .string("r-\(taskId)")
    object["taskId"] = .string(taskId)
    object["slot"] = .string(today)
    object["start"] = .string(today)
    object["every"] = .string("week")
    object["interval"] = .number("1")
    object["from"] = .string("schedule")
    return .object(object)
  }

  /// Today's draft, which carried these to-dos onto today's page: a row it applied is not a day chosen for its to-do,
  /// so the to-do is carried since it was first saved.
  private func draft(carrying taskIds: [String]) throws -> Page {
    let items = taskIds.map { #"{"id":"i-\#($0)","taskId":"\#($0)","state":"applied"}"# }.joined(separator: ",")
    var object = JSONObject()
    object["id"] = .string("draft:day:\(today)")
    object["type"] = .string("draft")
    object["date"] = .null
    object["title"] = .string("")
    object["document"] = .string(#"{"status":"ready","items":[\#(items)],"moreOpen":[]}"#)
    return try #require(Page(.object(object)))
  }

  private func link(blocked: String, blocker: String) -> JSONValue {
    var object = JSONObject()
    object["blockedId"] = .string(blocked)
    object["blockerId"] = .string(blocker)
    return .object(object)
  }

  extension OnScreen {
    @MainActor
    @Suite struct RowMarksTests {
      private func cell(_ screen: Screen, _ item: Int) throws -> TodoBlockCell {
        try #require(try screen.cell(item) as? TodoBlockCell, "row \(item) is not a to-do")
      }

      /// The marks a to-do row draws under its words: its list configuration's secondary text.
      private func marks(_ screen: Screen, _ item: Int) throws -> NSAttributedString? {
        (try cell(screen, item).contentConfiguration as? UIListContentConfiguration)?.secondaryAttributedText
      }

      private func color(of marks: NSAttributedString, at offset: Int) -> UIColor? {
        marks.attribute(.foregroundColor, at: offset, effectiveRange: nil) as? UIColor
      }

      private func isRepeatSymbol(_ marks: NSAttributedString, at offset: Int) -> Bool {
        guard let attachment = marks.attribute(.attachment, at: offset, effectiveRange: nil) as? NSTextAttachment,
          let image = attachment.image
        else { return false }
        return image.isSymbolImage && String(describing: image).contains("repeat")
      }

      @Test func each_mark_is_drawn_when_it_applies_and_not_otherwise() throws {
        let screen = try Screen.editing(
          [
            row("due", "k-due", "Pay the rent"),
            row("late", "k-late", "Send the form"),
            row("since", "k-since", "Fix the shelf"),
            row("rep", "k-rep", "Water the plants"),
            row("cx", "k-cx", "Return the parcel"),
            row("plain", "k-plain", "Call the bank"),
            row("all", "k-all", "Book the flights"),
          ],
          tasks: [
            todo("k-due", deadlineOn: "2026-11-27"), todo("k-late", deadlineOn: "2026-11-23"),
            todo("k-since", createdOn: "2026-11-03"), todo("k-rep"), todo("k-cx", status: "cancelled"),
            todo("k-plain"), todo("k-all", deadlineOn: "2026-11-27", createdOn: "2026-11-03"),
          ],
          today: today, pages: [try draft(carrying: ["k-since", "k-all"])],
          rest: [("todoRepeats", .array([weekly("k-rep"), weekly("k-all")]))])

        let due = try #require(try marks(screen, 0))
        #expect(due.string == "Due tomorrow")
        #expect(color(of: due, at: 0) == .secondaryLabel)
        let font = due.attribute(.font, at: 0, effectiveRange: nil) as? UIFont
        #expect(
          font?.fontDescriptor.object(forKey: .textStyle) as? UIFont.TextStyle == .footnote, "the marks are footnote")

        let late = try #require(try marks(screen, 1))
        #expect(late.string == "Was due Mon")
        #expect(color(of: late, at: 0) == .systemRed, "a passed Due date is red")

        #expect(try marks(screen, 2)?.string == "Since Nov 3")

        let repeats = try #require(try marks(screen, 3))
        #expect(repeats.length == 1)
        #expect(isRepeatSymbol(repeats, at: 0), "the repeat mark is the repeat symbol")

        #expect(try marks(screen, 4)?.string == "Cancelled")

        // The same row without any of these facts draws no secondary text.
        #expect(try marks(screen, 5) == nil)

        // Several marks share the line, a middle dot between them.
        let all = try #require(try marks(screen, 6))
        #expect(all.string == "Due tomorrow · Since Nov 3 · \u{FFFC}")
        #expect(isRepeatSymbol(all, at: all.length - 1))
      }

      @Test func blocked_by_is_a_line_of_its_own() throws {
        let screen = try Screen.editing(
          [
            row("one", "k-one", "Paint the hall"),
            row("two", "k-two", "Hang the pictures"),
            row("due", "k-due", "Move the sofa"),
            row("paint", "k-paint", "Buy paint"),
            row("brush", "k-brush", "Buy brushes"),
          ],
          tasks: [
            todo("k-one"), todo("k-two"), todo("k-due", deadlineOn: "2026-11-27"),
            todo("k-paint", title: "Buy paint"), todo("k-brush", title: "Buy brushes"),
          ],
          today: today,
          rest: [
            (
              "links",
              .array([
                link(blocked: "k-one", blocker: "k-paint"), link(blocked: "k-two", blocker: "k-paint"),
                link(blocked: "k-two", blocker: "k-brush"), link(blocked: "k-due", blocker: "k-paint"),
              ])
            )
          ])
        #expect(try marks(screen, 0)?.string == "Blocked by Buy paint")
        #expect(try marks(screen, 1)?.string == "Blocked by 2")
        #expect(try marks(screen, 2)?.string == "Due tomorrow\nBlocked by Buy paint")
        #expect(try marks(screen, 3) == nil)
      }

      @Test func reference_and_moved_to_only_at_regular_width() throws {
        let tomorrow = try makePage(
          [row("later", "k-moved", "Clean the oven", planDate: "2026-11-27")], id: "day:2026-11-27",
          date: "2026-11-27", type: "daily")
        let screen = try Screen.editing(
          [
            row("ref", "k-ref", "Read the lease", role: "reference", planDate: nil),
            row("moved", "k-moved", "Clean the oven"),
          ],
          tasks: [todo("k-ref"), todo("k-moved")], today: today, pages: [tomorrow])
        #expect(try marks(screen, 0) == nil)
        #expect(try marks(screen, 1) == nil)

        // The same rows, the window turned to regular width: no new rows, the cells draw by their own size class.
        screen.window.traitOverrides.horizontalSizeClass = .regular
        screen.window.layoutIfNeeded()
        #expect(try marks(screen, 0)?.string == "Reference")
        #expect(try marks(screen, 1)?.string == "Moved to Fri 11/27")

        screen.window.traitOverrides.horizontalSizeClass = .compact
        screen.window.layoutIfNeeded()
        #expect(try marks(screen, 0) == nil)
        #expect(try marks(screen, 1) == nil)
      }

      @Test func a_done_row_draws_no_marks() throws {
        let screen = try Screen.editing(
          [row("done", "k-done", "Pay the rent")],
          tasks: [todo("k-done", status: "done", deadlineOn: "2026-11-23", createdOn: "2026-11-03")],
          today: today, rest: [("todoRepeats", .array([weekly("k-done")]))])
        #expect(try marks(screen, 0) == nil)
      }

      @Test func a_to_do_typed_and_not_saved_draws_none() throws {
        // Its row names a to-do the workspace does not hold yet, or none.
        let screen = try Screen.editing(
          [row("n1", "editor-task:n1", "Water the plants"), row("n2", nil, "Feed the cat")], today: today)
        #expect(try marks(screen, 0) == nil)
        #expect(try marks(screen, 1) == nil)
        #expect(try cell(screen, 0).accessibilityElements as? [UIView] == [try cell(screen, 0).circle, try screen.line(0)])
      }

      @Test func the_marks_are_one_element_after_the_words() throws {
        let screen = try Screen.editing(
          [row("all", "k-all", "Book the flights"), row("paint", "k-paint", "Buy paint")],
          tasks: [todo("k-all", deadlineOn: "2026-11-27", createdOn: "2026-11-03"), todo("k-paint", title: "Buy paint")],
          today: today, pages: [try draft(carrying: ["k-all"])],
          rest: [
            ("todoRepeats", .array([weekly("k-all")])), ("links", .array([link(blocked: "k-all", blocker: "k-paint")])),
          ])
        let cell = try cell(screen, 0)
        let elements = try #require(cell.accessibilityElements)
        #expect(elements.count == 3)
        #expect(elements.first as? UIView === cell.circle)
        #expect(elements.dropFirst().first as? UIView === cell.line)
        let marks = try #require(elements.last as? UIAccessibilityElement)
        #expect(marks.accessibilityLabel == "Due tomorrow, Since Nov 3, Repeats every week, Blocked by Buy paint")
        #expect(!marks.accessibilityFrameInContainerSpace.isEmpty)
        #expect(cell.circle.accessibilityLabel == "Complete Book the flights")
      }

      @Test func at_the_largest_text_size_and_in_landscape_the_marks_wrap_and_nothing_is_cut() throws {
        let blocker = "Buy paint, brushes and tape for the hallway, the kitchen and the stairs"
        let screen = try Screen.editing(
          [
            row("all", "k-all", "Book the flights"), row("plain", "k-plain", "Call the bank"),
            row("paint", "k-paint", "Buy paint"),
          ],
          tasks: [
            todo("k-all", deadlineOn: "2026-11-27", createdOn: "2026-11-03"), todo("k-plain"),
            todo("k-paint", title: blocker),
          ],
          width: 874, height: 402, category: .accessibilityExtraExtraExtraLarge, today: today,
          pages: [try draft(carrying: ["k-all"])],
          rest: [
            ("todoRepeats", .array([weekly("k-all")])), ("links", .array([link(blocked: "k-all", blocker: "k-paint")])),
          ])
        let cell = try cell(screen, 0)
        let content = try #require(cell.contentView as? UIListContentView)
        let guide = try #require(content.secondaryTextLayoutGuide)
        let frame = content.convert(guide.layoutFrame, to: cell)
        let footnote = UIFont.preferredFont(forTextStyle: .footnote, compatibleWith: cell.traitCollection)
        #expect(frame.height > footnote.lineHeight * 2.5, "the marks and Blocked by wrap onto more lines")
        #expect(cell.bounds.insetBy(dx: -0.5, dy: -0.5).contains(frame), "no part of the marks lies outside the row")
        let words = cell.line.convert(cell.line.bounds, to: cell)
        #expect(words.maxY <= frame.minY + 0.5, "the words keep the first line, the marks are under them")
        let width = cell.line.bounds.width

        screen.list.scrollToItem(at: IndexPath(item: 1, section: 0), at: .top, animated: false)
        let plain = try self.cell(screen, 1)
        #expect(try marks(screen, 1) == nil)
        #expect(abs(plain.line.bounds.width - width) < 0.5, "the words keep their width")
      }

      @Test func typing_in_a_row_with_marks_redraws_nothing_else() throws {
        let screen = try Screen.editing(
          [row("due", "k-due", "Pay the rent"), row("late", "k-late", "Send the form"), block("p", "paragraph", text: "Notes")],
          tasks: [todo("k-due", deadlineOn: "2026-11-27"), todo("k-late", deadlineOn: "2026-11-23")], today: today)
        let line = try screen.focus(0)
        let others = [try screen.cell(1), try screen.cell(2)]
        let before = [try marks(screen, 0), try marks(screen, 1)]
        let snapshots = screen.controller.appliedSnapshots
        for character in " now" { line.insertText(String(character)) }
        screen.window.layoutIfNeeded()
        #expect(try screen.words()[0] == "Pay the rent now")
        #expect(screen.controller.appliedSnapshots == snapshots, "no snapshot is applied for a keystroke")
        #expect(try screen.cell(1) === others[0])
        #expect(try screen.cell(2) === others[1])
        #expect(try marks(screen, 0) == before[0])
        #expect(try marks(screen, 1) == before[1])
        #expect(line.isFirstResponder)
      }

      @Test func the_marks_follow_today() throws {
        let screen = try Screen.editing(
          [row("due", "k-due", "Pay the rent"), block("p", "paragraph", text: "Notes")],
          tasks: [todo("k-due", deadlineOn: "2026-11-27")], today: today)
        #expect(try marks(screen, 0)?.string == "Due tomorrow")
        // The caret is in the row whose facts change: it is redrawn in place, and keeps the caret and the keyboard.
        let line = try screen.focus(0, at: 3)
        let cell = try cell(screen, 0)
        screen.controller.today = LocalDate("2026-11-27")
        screen.window.layoutIfNeeded()
        #expect(try marks(screen, 0)?.string == "Due today")
        #expect(try screen.cell(0) === cell, "the row keeps its cell")
        #expect(line.isFirstResponder)
        #expect(line.selectedRange == NSRange(location: 3, length: 0))
        #expect(screen.controller.redrawnRows == ["due"], "only the row whose facts changed is redrawn")

        screen.controller.today = nil
        screen.window.layoutIfNeeded()
        #expect(try marks(screen, 0) == nil, "without today a row draws no facts")
      }

      // MARK: the circle

      /// The middle of the words' first line, in the cell's coordinates, as the text view lays it out.
      private func firstLineMidline(of cell: TodoBlockCell) throws -> CGFloat {
        let line = cell.line
        let manager = try #require(line.textLayoutManager)
        var midline: CGFloat?
        manager.enumerateTextLayoutFragments(from: manager.documentRange.location, options: [.ensuresLayout]) {
          fragment in
          if let first = fragment.textLineFragments.first {
            midline = fragment.layoutFragmentFrame.minY + first.typographicBounds.midY
          }
          return false
        }
        return line.convert(CGPoint(x: 0, y: try #require(midline)), to: cell).y
      }

      @Test(arguments: [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge])
      func the_circle_is_level_with_the_words_first_line(category: UIContentSizeCategory) throws {
        let screen = try Screen.editing(
          [
            row("due", "k-due", "Pay the rent"),
            row("all", "k-all", "Book the flights"),
            row("plain", "k-plain", "Call the bank"),
            row("long", "k-long", "Book the flights for the trip in December and the hotel near the station"),
            row("paint", "k-paint", "Buy paint"),
          ],
          tasks: [
            todo("k-due", deadlineOn: "2026-11-27"), todo("k-all", deadlineOn: "2026-11-27", createdOn: "2026-11-03"),
            todo("k-plain"), todo("k-long"), todo("k-paint", title: "Buy paint"),
          ],
          height: 3000, category: category, today: today, pages: [try draft(carrying: ["k-all"])],
          rest: [
            ("todoRepeats", .array([weekly("k-all")])), ("links", .array([link(blocked: "k-all", blocker: "k-paint")])),
          ])
        #expect(try marks(screen, 0) != nil)
        #expect(try marks(screen, 1)?.string.contains("\n") == true, "the second row has three lines")
        #expect(try marks(screen, 2) == nil)
        #expect(try marks(screen, 3) == nil)
        let long = try cell(screen, 3)
        let bodyLine = UIFont.preferredFont(forTextStyle: .body, compatibleWith: long.traitCollection).lineHeight
        #expect(long.line.bounds.height > bodyLine * 1.5, "the long words wrap")

        var offsets: [CGFloat] = []
        for item in 0..<4 {
          let cell = try cell(screen, item)
          let midline = try firstLineMidline(of: cell)
          #expect(
            abs(cell.circle.center.y - midline) < 1,
            "row \(item): the circle's centre \(cell.circle.center.y) is level with the first line's middle \(midline)")
          offsets.append(cell.circle.center.y - cell.line.frame.minY)
        }
        // One rule for every row: the same offset from the row's own first line.
        #expect(offsets.allSatisfy { abs($0 - offsets[0]) < 0.5 }, "offsets from the first line: \(offsets)")
        #expect(try cell(screen, 0).circle.bounds.width >= 44, "the touch target is kept")
      }

      /// Within a pixel of the middle of the first line as laid out, for words in a fallback font (Chinese, emoji),
      /// drawn or typed. Plain Chinese is laid out at the body line's height; a chip whose words fall back (a page
      /// titled in Chinese) makes the line taller, and the circle follows it.
      @Test(arguments: [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge])
      func the_circle_is_level_with_a_first_line_in_a_fallback_font(category: UIContentSizeCategory) throws {
        let list = try #require(
          Page(.object([
            "id": .string("shop"), "type": .string("document"), "date": .null, "title": .string("购物清单"),
            "document": .string("[]"),
          ])))
        let reference: JSONValue = .object([
          "type": .string("pageRef"), "props": .object(["pageId": .string("shop"), "refId": .string("r")]),
        ])
        var chip = row("chip", "k-chip", "")
        chip.content = .array([reference, run(" for the weekend")])
        let screen = try Screen.editing(
          [
            row("zh", "k-zh", "今天下午去银行办事，顺便买菜和水果，晚上做饭"),
            row("mixed", "k-mixed", "Buy 牛奶 and bread"),
            row("emoji", "k-emoji", "🎂 Order the cake"),
            chip,
            row("typed", "k-typed", "Call"),
          ],
          tasks: [
            todo("k-zh", deadlineOn: "2026-11-27"), todo("k-mixed"), todo("k-emoji"), todo("k-chip"), todo("k-typed"),
          ],
          height: 3000, category: category, today: today, pages: [list])
        let pixel = 1 / screen.window.screen.scale + 0.01
        for item in 0..<4 {
          let cell = try cell(screen, item)
          let midline = try firstLineMidline(of: cell)
          #expect(
            abs(cell.circle.center.y - midline) < pixel,
            "row \(item): the circle's centre \(cell.circle.center.y) is level with the first line's middle \(midline)")
        }
        // Chinese typed at the start of a Latin line.
        let line = try screen.focus(4, at: 0)
        line.insertText("打电话 ")
        screen.window.layoutIfNeeded()
        let typed = try cell(screen, 4)
        let midline = try firstLineMidline(of: typed)
        #expect(abs(typed.circle.center.y - midline) < pixel, "typed: \(typed.circle.center.y) against \(midline)")
      }

      // MARK: facts that change while he composes

      @Test func facts_that_change_while_he_composes_are_drawn_when_he_commits() throws {
        let screen = try Screen.editing(
          [row("due", "k-due", "Pay the rent"), block("p", "paragraph", text: "Notes")],
          tasks: [todo("k-due", deadlineOn: "2026-11-27")], today: today)
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(0)
        line.setMarkedText("今", selectedRange: NSRange(location: 1, length: 0))
        screen.controller.today = LocalDate("2026-11-27")
        screen.window.layoutIfNeeded()
        #expect(try marks(screen, 0)?.string == "Due tomorrow", "the row being composed in is not redrawn")
        let cell = try cell(screen, 0)
        line.unmarkText()
        screen.window.layoutIfNeeded()
        #expect(try marks(screen, 0)?.string == "Due today")
        #expect(try screen.cell(0) === cell)
        #expect(line.isFirstResponder)
        #expect(line.selectedRange == NSRange(location: 13, length: 0))
        #expect(try screen.words()[0] == "Pay the rent今")
        #expect(reports == 1, "only the composition's commit is reported")
      }

      @Test func facts_that_change_while_he_composes_nothing_are_drawn_when_it_ends() throws {
        let screen = try Screen.editing(
          [row("due", "k-due", "Pay the rent"), block("p", "paragraph", text: "Notes")],
          tasks: [todo("k-due", deadlineOn: "2026-11-27")], today: today)
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(0, at: 3)
        line.setMarkedText("x", selectedRange: NSRange(location: 1, length: 0))
        screen.controller.today = LocalDate("2026-11-27")
        line.setMarkedText("", selectedRange: NSRange(location: 0, length: 0))
        line.unmarkText()
        screen.window.layoutIfNeeded()
        #expect(try marks(screen, 0)?.string == "Due today")
        #expect(line.isFirstResponder)
        #expect(line.selectedRange == NSRange(location: 3, length: 0))
        #expect(reports == 0)
      }

      @Test func facts_changed_from_outside_while_he_composes_are_drawn_when_he_commits() throws {
        let screen = try Screen.editing(
          [row("due", "k-due", "Pay the rent"), block("p", "paragraph", text: "Notes")],
          tasks: [todo("k-due", deadlineOn: "2026-11-27")], today: today)
        var reports = 0
        screen.controller.onChange = { _, _ in reports += 1 }
        let line = try screen.focus(0)
        line.setMarkedText("今", selectedRange: NSRange(location: 1, length: 0))
        // The server sets the row's plan day to the Due day.
        let moved = try makePage(
          [row("due", "k-due", "Pay the rent", planDate: "2026-11-27"), block("p", "paragraph", text: "Notes")],
          id: "day:\(today)", date: today, type: "daily")
        screen.controller.replace(
          document: moved.document,
          in: try makeWorkspace(pages: [moved], tasks: [todo("k-due", deadlineOn: "2026-11-27")]))
        screen.window.layoutIfNeeded()
        #expect(try marks(screen, 0)?.string == "Due tomorrow", "the row being composed in is not redrawn")
        line.unmarkText()
        screen.window.layoutIfNeeded()
        #expect(try marks(screen, 0)?.string == "Due that day")
        #expect(line.isFirstResponder)
        #expect(line.selectedRange == NSRange(location: 13, length: 0))
        #expect(try screen.words()[0] == "Pay the rent今")
        #expect(reports == 1)
      }

      // MARK: the marks element

      @Test func a_reused_cell_speaks_for_the_row_it_now_shows() throws {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        let cell = TodoBlockCell(frame: CGRect(x: 0, y: 0, width: 390, height: 80))
        window.addSubview(cell)
        let day = try #require(LocalDate(today))
        let page = try makePage(
          [row("due", "k-due", "Pay the rent"), row("plain", "k-plain", "Call the bank")], id: "day:\(day.value)",
          date: day.value, type: "daily")
        let workspace = try makeWorkspace(
          pages: [page], tasks: [todo("k-due", deadlineOn: "2026-11-27"), todo("k-plain")])
        let rows = BlockRows.rows(for: page, in: workspace, today: day)
        func show(_ row: BlockRow) {
          guard case .todo(_, let status, _, let facts) = row.kind else { return }
          cell.configure(
            status: status, facts: facts, canBeTicked: true, depth: 0, text: AttributedString("words"),
            editable: true, rowID: row.id, delegate: nil, onTick: {})
          cell.updateConfiguration(using: cell.configurationState)
          let height = cell.systemLayoutSizeFitting(
            CGSize(width: 390, height: 0), withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
          ).height
          cell.frame = CGRect(x: 0, y: 0, width: 390, height: height)
          cell.layoutIfNeeded()
        }
        func marksFrame() throws -> CGRect {
          let content = try #require(cell.contentView as? UIListContentView)
          let guide = try #require(content.secondaryTextLayoutGuide)
          return content.convert(guide.layoutFrame, to: cell)
        }
        func check(hasMarks: Bool, label: String?) throws {
          let elements = try #require(cell.accessibilityElements)
          #expect(elements.count == (hasMarks ? 3 : 2))
          guard hasMarks, let marks = elements.last as? UIAccessibilityElement else { return }
          #expect(marks.accessibilityLabel == label)
          let frame = try marksFrame()
          #expect(!frame.isEmpty)
          #expect(marks.accessibilityFrameInContainerSpace == frame)
        }
        show(rows[0])
        try check(hasMarks: true, label: "Due tomorrow")
        show(rows[1])
        try check(hasMarks: false, label: nil)
        show(rows[0])
        try check(hasMarks: true, label: "Due tomorrow")

        // Other marks of the same height: the frame is the line's as drawn now, without the cell laid out again.
        let later = BlockRows.rows(for: page, in: workspace, today: LocalDate("2026-11-27"))
        guard case .todo(_, let status, _, let facts) = later[0].kind else { return }
        cell.configure(
          status: status, facts: facts, canBeTicked: true, depth: 0, text: AttributedString("words"), editable: true,
          rowID: later[0].id, delegate: nil, onTick: {})
        cell.updateConfiguration(using: cell.configurationState)
        cell.contentView.layoutIfNeeded()
        let marks = try #require(cell.accessibilityElements?.last as? UIAccessibilityElement)
        #expect(marks.accessibilityLabel == "Due today")
        #expect(marks.accessibilityFrameInContainerSpace == (try marksFrame()))
      }
    }
  }
#endif
