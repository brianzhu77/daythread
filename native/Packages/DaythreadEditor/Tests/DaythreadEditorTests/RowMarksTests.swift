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
          today: today, rest: [("todoRepeats", .array([weekly("k-rep"), weekly("k-all")]))])

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
          today: today,
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
    }
  }
#endif
