#if canImport(UIKit)
  import DaythreadCore
  import Testing
  import UIKit

  @testable import DaythreadEditor

  /// The day the to-do rows are drawn on, when a test needs their facts.
  private let today = "2026-11-26"

  private func openTodo(_ id: String) -> JSONValue {
    var object = JSONObject()
    object["id"] = .string(id)
    object["title"] = .string("A to-do")
    object["status"] = .string("open")
    object["paused"] = .bool(false)
    object["deadlineOn"] = .null
    object["attentionOn"] = .null
    return .object(object)
  }

  /// A to-do row planned for `today`.
  private func todoRow(_ id: String, _ taskId: String, _ words: String, children: [Block] = []) -> Block {
    var props = JSONObject()
    props["taskId"] = .string(taskId)
    props["role"] = .string("plan")
    props["planDate"] = .string(today)
    return Block(
      id: id, type: "task", props: props, content: words.isEmpty ? .array([]) : .array([run(words)]),
      children: children)
  }

  private func heading(_ id: String, _ words: String) -> Block {
    block(id, "heading", ["level": .number("1")], text: words)
  }

  /// The page of these tests: a heading `TODO`, a to-do `t1` with `n1` nested under it, an empty to-do `t2`, a bullet
  /// `b1`, a heading `Notes`, and the lines `p1`…`p<lines>`.
  private func dayBlocks(lines: Int = 40) -> [Block] {
    [
      heading("h1", "TODO"),
      todoRow("t1", "k1", "Call the bank", children: [block("n1", "paragraph", text: "Ask about the card")]),
      todoRow("t2", "k2", ""),
      block("b1", "bulletListItem", text: "A bullet of his"),
      heading("h2", "Notes"),
    ] + paragraphs(lines)
  }

  private func paragraphs(_ count: Int) -> [Block] {
    (1...count).map { block("p\($0)", "paragraph", text: "Line \($0)") }
  }

  private let dayTasks = [openTodo("k1"), openTodo("k2")]

  /// A guest with the two actions a suggestion has.
  private func guest(
    _ id: String, after lineID: String?, kind: GuestRow.Kind = .todo, words: String = "Book the flights",
    detail: String = "Thu 11/19", spokenDetail: String? = "Thursday 11/19"
  ) -> GuestRow {
    GuestRow(
      id: id, place: .after(lineID: lineID), kind: kind, words: words, detail: detail, spokenDetail: spokenDetail,
      spokenKind: "Suggestion",
      actions: [
        GuestRow.Action(id: "apply", symbol: "checkmark", label: "Apply \(words)", spokenName: "Apply"),
        GuestRow.Action(id: "skip", symbol: "xmark", label: "Skip \(words)", spokenName: "Skip"),
      ])
  }

  extension OnScreen {
    /// Rows of the page's list that are not lines of the page (§13.5, §13.6; Review Focus 1).
    @MainActor
    @Suite struct GuestRowTests {
      /// The list's items as names: a line's id, or `guest:` and the guest's id.
      private func listed(_ screen: Screen) -> [String] {
        _ = screen.list
        return screen.controller.orderedItems.map {
          switch $0 {
          case .line(let id): id
          case .guest(let id): "guest:\(id)"
          }
        }
      }

      private func item(_ name: String, in screen: Screen) throws -> Int {
        try #require(listed(screen).firstIndex(of: name), "\(name) is not listed")
      }

      private func guestCell(_ id: String, in screen: Screen) throws -> GuestRowCell {
        try #require(try screen.cell(try item("guest:\(id)", in: screen)) as? GuestRowCell, "guest \(id) has no cell")
      }

      private func lineCell(_ id: String, in screen: Screen) throws -> LineBlockCell {
        try #require(try screen.cell(try item(id, in: screen)) as? LineBlockCell, "line \(id) has no cell")
      }

      private func frame(_ view: UIView, in screen: Screen) -> CGRect { view.convert(view.bounds, to: screen.list) }

      /// Where a view is drawn now, as Core Animation shows it (its presentation layer, inside the list's presentation
      /// bounds), so a place an animation shows it at is seen.
      private func drawnY(of view: UIView, in list: UICollectionView) -> CGFloat {
        let viewY = (view.layer.presentation() ?? view.layer).frame.minY
        let listY = (list.layer.presentation() ?? list.layer).bounds.minY
        return viewY - listY
      }

      /// The farthest the view was drawn from `y`, sampled every 1/120 s for `seconds`.
      private func worstDeviation(of view: UIView, in list: UICollectionView, from y: CGFloat, for seconds: TimeInterval)
        -> CGFloat
      {
        var worst: CGFloat = 0
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
          RunLoop.current.run(until: Date().addingTimeInterval(1.0 / 120))
          let deviation = drawnY(of: view, in: list) - y
          if abs(deviation) > abs(worst) { worst = deviation }
        }
        return worst
      }

      /// A page of `lines` lines with the caret in `p<typed>`, scrolled to show it and the keyboard up.
      private func typing(in typed: Int, of lines: Int) throws -> (screen: Screen, line: LineTextView, watch: KeyboardWatch)
      {
        let screen = try Screen.editing(paragraphs(lines))
        let watch = KeyboardWatch(screen)
        let list = screen.list
        list.scrollToItem(at: IndexPath(item: typed - 1, section: 0), at: .centeredVertically, animated: false)
        let line = try screen.focus(typed - 1, at: 2)
        #expect(screen.wait { list.contentInset.bottom > 100 }, "the keyboard did not come up")
        _ = screen.wait(1) { false }
        #expect(line.rowID == "p\(typed)")
        return (screen, line, watch)
      }

      // MARK: where they go

      @Test func guests_follow_their_lines() throws {
        let blocks = dayBlocks(lines: 3)
        let screen = try Screen.editing(blocks, tasks: dayTasks)
        screen.controller.setGuestRows([
          guest("g1", after: "n1"), guest("g0", after: nil), guest("g2", after: "t2"), guest("g3", after: "t2"),
        ])
        #expect(
          listed(screen) == [
            "guest:g0", "h1", "t1", "n1", "guest:g1", "t2", "guest:g2", "guest:g3", "b1", "h2", "p1", "p2", "p3",
          ])
        #expect(screen.controller.itemCount == 13)
        #expect(BlockRows.lastRowID(ofBlock: "t1", in: blocks) == "n1")
        #expect(BlockRows.lastRowID(ofBlock: "t2", in: blocks) == "t2")
        #expect(BlockRows.lastRowID(ofBlock: "n1", in: blocks) == nil, "n1 is not a top-level block")
        #expect(BlockRows.lastRowID(ofBlock: "nowhere", in: blocks) == nil)
        // The second `c` is listed as `c#2`.
        let repeated = [
          block("a", "paragraph", text: "A", children: [block("c", "paragraph", text: "C")]),
          block("b", "paragraph", text: "B", children: [block("c", "paragraph", text: "C again")]),
        ]
        #expect(BlockRows.lastRowID(ofBlock: "a", in: repeated) == "c")
        #expect(BlockRows.lastRowID(ofBlock: "b", in: repeated) == "c#2")
      }

      @Test func a_guest_whose_line_is_not_in_the_list_is_not_drawn() throws {
        let screen = try Screen.editing(paragraphs(3))
        screen.controller.setGuestRows([guest("gone", after: "p9"), guest("g1", after: "p2")])
        #expect(listed(screen) == ["p1", "p2", "guest:g1", "p3"])
        // Its line leaves the page: it is no longer drawn.
        screen.controller.replace(document: Document.write(paragraphs(1)), in: try makeWorkspace())
        #expect(listed(screen) == ["p1"])
      }

      @Test func a_guest_with_a_lines_id_is_drawn_as_a_guest() throws {
        let screen = try Screen.editing(paragraphs(3))
        screen.controller.setGuestRows([guest("p1", after: "p2", words: "Same id as a line")])
        #expect(listed(screen) == ["p1", "p2", "guest:p1", "p3"])
        #expect(try screen.cell(0) is TextBlockCell)
        #expect(try screen.cell(2) is GuestRowCell)
        #expect(try screen.line(0).text == "Line 1")
      }

      // MARK: not a line

      @Test func a_guest_is_no_line_of_the_page() throws {
        let screen = try Screen.editing(dayBlocks(lines: 3), tasks: dayTasks)
        var changes = 0
        screen.controller.onChange = { _, _ in changes += 1 }
        let document = screen.controller.document
        screen.controller.setGuestRows([guest("g1", after: "n1"), guest("g2", after: "t2", words: "Pack the charger")])
        #expect(changes == 0)
        #expect(screen.controller.document == document)

        // Down from `n1` passes the guest under it.
        let nested = try screen.focus(try item("n1", in: screen))
        try screen.press(nested, UIKeyCommand.inputDownArrow)
        _ = screen.list
        #expect(screen.controller.focusedLine?.rowID == "t2")
        // Backspace at the start of the empty `t2` takes it away into the line above, past the guest between.
        let empty = try #require(screen.controller.focusedLine)
        empty.selectedRange = NSRange(location: 0, length: 0)
        empty.deleteBackward()
        _ = screen.list
        #expect(screen.controller.focusedLine?.rowID == "n1")
        #expect(screen.controller.focusedLine?.selectedRange.location == ("Ask about the card" as NSString).length)
        #expect(!listed(screen).contains("t2"))
        #expect(!listed(screen).contains("guest:g2"), "its line went, and so did it")

        // A tap on a guest's words lands on nothing that takes the keyboard.
        let cell = try guestCell("g1", in: screen)
        let words = cell.wordsLabel.convert(cell.wordsLabel.bounds, to: cell)
        let hit = try #require(cell.hitTest(CGPoint(x: words.midX, y: words.midY), with: nil))
        #expect(!(hit is UITextView) && !hit.canBecomeFirstResponder)
        #expect(!screen.controller.takesTapUnderTheLastLine(at: cell.convert(CGPoint(x: words.midX, y: words.midY), to: screen.list)))

        // Select all and copy, in a line: the line's words, no guest's.
        let line = try screen.focus(try item("p1", in: screen))
        line.selectAll(nil)
        #expect(line.text(in: try #require(line.selectedTextRange)) == "Line 1")
        line.copy(nil)
        #expect(UIPasteboard.general.string == "Line 1")
        #expect(changes == 1, "only the Backspace was a change")
      }

      @Test func nil_keeps_the_guests_and_an_empty_list_removes_them() throws {
        let screen = try Screen.editing(paragraphs(3))
        screen.controller.setGuestRows([guest("g1", after: "p1")])
        var changed = paragraphs(3)
        changed[1] = block("p2", "paragraph", text: "Line 2, changed")
        screen.controller.replace(document: Document.write(changed), in: try makeWorkspace(), guests: nil)
        #expect(listed(screen) == ["p1", "guest:g1", "p2", "p3"])
        #expect(try screen.words() == ["Line 1", "Line 2, changed", "Line 3"])
        let page = try makePage(changed)
        screen.controller.edit(page: page, in: try makeWorkspace())
        #expect(listed(screen) == ["p1", "guest:g1", "p2", "p3"])
        screen.controller.replace(document: Document.write(changed), in: try makeWorkspace(), guests: [])
        #expect(listed(screen) == ["p1", "p2", "p3"])

        // A page that is only shown takes them too.
        screen.controller.show(page: page, in: try makeWorkspace(), guests: [guest("g2", after: "p3")])
        #expect(listed(screen) == ["p1", "p2", "p3", "guest:g2"])
        screen.controller.show(page: page, in: try makeWorkspace())
        #expect(listed(screen) == ["p1", "p2", "p3", "guest:g2"])
      }

      // MARK: typing

      /// Fifty keystrokes in `p20` of a 300-line page take the path that redraws nothing, with three guests as
      /// without: a keystroke that restructured the page, or compared the list's items, would apply a snapshot.
      @Test(arguments: [false, true])
      func typing_with_guests_takes_the_fast_path(withGuests: Bool) throws {
        let screen = try Screen.editing(paragraphs(300))
        if withGuests {
          screen.controller.setGuestRows([
            guest("g1", after: "p5"), guest("g2", after: "p100", kind: .bullet), guest("g3", after: "p19", kind: .line),
          ])
        }
        #expect(screen.controller.itemCount == (withGuests ? 303 : 300))
        let target = try item("p20", in: screen)
        screen.list.scrollToItem(at: IndexPath(item: target, section: 0), at: .centeredVertically, animated: false)
        let line = try screen.focus(target)
        #expect(line.rowID == "p20")
        _ = screen.wait(0.5) { false }
        let above = withGuests ? try guestCell("g3", in: screen) : nil
        let snapshots = screen.controller.appliedSnapshots
        let redrawn = screen.controller.redrawnRows
        let redrawnGuests = screen.controller.redrawnGuests
        let clock = ContinuousClock()
        var times: [Double] = []
        for index in 0..<50 {
          let start = clock.now
          line.insertText(index % 5 == 0 ? " " : "x")
          screen.window.layoutIfNeeded()
          times.append((clock.now - start) / .milliseconds(1))
        }
        #expect(screen.controller.appliedSnapshots == snapshots, "a keystroke applied a snapshot")
        #expect(screen.controller.redrawnRows == redrawn)
        #expect(screen.controller.redrawnGuests == redrawnGuests, "a guest was reconfigured")
        #expect(line.isFirstResponder)
        if withGuests { #expect(try guestCell("g3", in: screen) === above) }
        let median = times.sorted()[25]
        print("GuestRowTests: guests \(withGuests), 50 keystrokes in p20 of 300: median \(String(format: "%.3f", median)) ms")
      }

      // MARK: the actions

      @Test func the_host_is_told_which_action_was_used() throws {
        let screen = try Screen.editing(paragraphs(3))
        var used: [String] = []
        screen.controller.onGuestAction = { used.append("\($0):\($1)") }
        screen.controller.setGuestRows([guest("g1", after: "p1")])
        let cell = try guestCell("g1", in: screen)
        try #require(cell.button(symbol: "checkmark")).sendActions(for: .primaryActionTriggered)
        let skip = try #require(cell.accessibilityCustomActions?.first { $0.name == "Skip" })
        #expect(skip.actionHandler?(skip) == true)
        #expect(used == ["g1:apply", "g1:skip"])
      }

      @Test func voiceover_reads_a_guest_as_one_element_with_its_actions() throws {
        let screen = try Screen.editing(paragraphs(3))
        screen.controller.setGuestRows([
          guest("g1", after: "p1"),
          guest("g2", after: "p2", words: "Pack the charger", detail: "", spokenDetail: nil),
        ])
        let first = try guestCell("g1", in: screen)
        #expect(first.isAccessibilityElement)
        #expect(first.accessibilityLabel == "Suggestion, Book the flights, Thursday 11/19")
        #expect((first.accessibilityCustomActions ?? []).map(\.name) == ["Apply", "Skip"])
        #expect(first.actionButtons.map(\.accessibilityLabel) == ["Apply Book the flights", "Skip Book the flights"])
        let second = try guestCell("g2", in: screen)
        #expect(second.accessibilityLabel == "Suggestion, Pack the charger")
      }

      // MARK: the cell

      /// The page with a to-do guest after `t2`, a bullet guest after `b1` and a line guest after `p1`, on a screen tall
      /// enough that every row is laid out at the largest text size.
      private func everyKind(_ category: UIContentSizeCategory) throws -> Screen {
        let screen = try Screen.editing(dayBlocks(lines: 3), tasks: dayTasks, height: 3200, category: category)
        screen.controller.setGuestRows([
          guest("gt", after: "t2"),
          guest("gb", after: "b1", kind: .bullet, words: "Water the plants", detail: "Tue 11/24"),
          guest("gl", after: "p1", kind: .line, words: "A carried line", detail: "Wed 11/25"),
        ])
        _ = screen.list
        return screen
      }

      private func bodyFont(_ category: UIContentSizeCategory) -> UIFont {
        UIFont.preferredFont(
          forTextStyle: .body, compatibleWith: UITraitCollection(preferredContentSizeCategory: category))
      }

      @Test(arguments: [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge])
      func the_words_keep_the_column_of_his_rows(category: UIContentSizeCategory) throws {
        let screen = try everyKind(category)
        let pairs: [(guest: String, line: String)] = [("gt", "t2"), ("gb", "b1"), ("gl", "p1")]
        for pair in pairs {
          let words = frame(try guestCell(pair.guest, in: screen).wordsLabel, in: screen)
          let his = frame(try lineCell(pair.line, in: screen).line, in: screen)
          #expect(abs(words.minX - his.minX) < 1, "\(pair.guest)'s words start at \(words.minX), \(pair.line)'s at \(his.minX)")
        }
      }

      @Test(arguments: [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge])
      func the_mark_is_level_with_the_first_line(category: UIContentSizeCategory) throws {
        let screen = try everyKind(category)
        let font = bodyFont(category)
        for id in ["gt", "gb"] {
          let cell = try guestCell(id, in: screen)
          let mark = try #require(cell.markCentre, "\(id) has no mark")
          let firstLine = cell.wordsLabel.convert(CGPoint(x: 0, y: font.lineHeight / 2), to: cell).y
          #expect(abs(mark.y - firstLine) < 1, "\(id)'s mark at \(mark.y), its first line's middle at \(firstLine)")
        }
        // The dashed circle in the circle's column, the dot in the bullet's.
        let circle = try #require((try lineCell("t2", in: screen) as? TodoBlockCell)?.circle)
        let dashed = try guestCell("gt", in: screen)
        let dashedCentre = dashed.convert(try #require(dashed.markCentre), to: screen.list)
        #expect(abs(dashedCentre.x - frame(circle, in: screen).midX) < 1)
        let bullet = try lineCell("b1", in: screen)
        let slot = try #require((bullet.contentView as? UIListContentView)?.imageLayoutGuide)
        let bulletColumn = bullet.contentView.convert(slot.layoutFrame, to: screen.list)
        let dot = try guestCell("gb", in: screen)
        let dotCentre = dot.convert(try #require(dot.markCentre), to: screen.list)
        #expect(bulletColumn.minX <= dotCentre.x && dotCentre.x <= bulletColumn.maxX)
        #expect(try guestCell("gl", in: screen).markCentre == nil, "a line guest has no mark")
      }

      @Test(arguments: [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge])
      func the_buttons_are_44_points_and_never_clip_their_symbols(category: UIContentSizeCategory) throws {
        let screen = try everyKind(category)
        let font = bodyFont(category)
        for id in ["gt", "gb", "gl"] {
          let cell = try guestCell(id, in: screen)
          let words = cell.wordsLabel.convert(cell.wordsLabel.bounds, to: cell)
          let firstLine = words.minY + font.lineHeight / 2
          #expect(cell.actionButtons.count == 2)
          for button in cell.actionButtons {
            let target = button.convert(button.bounds, to: cell)
            #expect(target.width >= 44 && target.height >= 44, "\(id)'s button is \(target.size)")
            let symbol = try #require(button.imageView, "\(id)'s button draws no symbol")
            let glyph = symbol.convert(symbol.bounds, to: button)
            #expect(button.bounds.insetBy(dx: -0.5, dy: -0.5).contains(glyph), "\(id)'s symbol \(glyph) is cut by \(button.bounds)")
            #expect(glyph.height <= font.lineHeight + 0.5, "the symbol is larger than the words")
            #expect(cell.bounds.insetBy(dx: -0.5, dy: -0.5).contains(target), "\(id)'s button is cut by its row")
            if category.isAccessibilityCategory {
              #expect(target.minY >= words.maxY - 0.5, "under the words")
            } else {
              #expect(abs(target.midY - firstLine) < 1, "on the first line")
              #expect(target.minX >= words.maxX - 0.5, "beside the words")
            }
          }
        }
      }

      // MARK: the typed line stays where it is

      @Test func guests_arriving_above_the_typed_line_keep_it_where_it_is() throws {
        let (screen, line, watch) = try typing(in: 30, of: 60)
        let list = screen.list
        let cell = try #require(line.superview)
        let selection = line.selectedRange
        let before = drawnY(of: cell, in: list)

        screen.controller.setGuestRows([
          guest("g1", after: "p20"), guest("g2", after: "p25", kind: .bullet), guest("g3", after: "p28", kind: .line),
        ])
        let worst = worstDeviation(of: cell, in: list, from: before, for: 0.6)

        #expect(screen.controller.itemCount == 63)
        #expect(abs(worst) < 0.5, "the line was drawn \(worst) points away")
        #expect(line.isFirstResponder)
        #expect(line.superview === cell, "the line's cell changed")
        #expect(line.selectedRange == selection)
        #expect(watch.droppedWhileTyping == 0, "the keyboard went down")
        #expect(screen.controller.appliedAnimated.last == false)
      }

      @Test func guests_leaving_above_the_typed_line_keep_it_where_it_is() throws {
        let (screen, line, watch) = try typing(in: 30, of: 60)
        screen.controller.setGuestRows([
          guest("g1", after: "p20"), guest("g2", after: "p25", kind: .bullet), guest("g3", after: "p28", kind: .line),
        ])
        _ = screen.wait(0.5) { false }
        let list = screen.list
        let cell = try #require(line.superview)
        let selection = line.selectedRange
        let before = drawnY(of: cell, in: list)

        screen.controller.setGuestRows([])
        let worst = worstDeviation(of: cell, in: list, from: before, for: 0.6)

        #expect(screen.controller.itemCount == 60)
        #expect(abs(worst) < 0.5, "the line was drawn \(worst) points away")
        #expect(line.isFirstResponder)
        #expect(line.superview === cell, "the line's cell changed")
        #expect(line.selectedRange == selection)
        #expect(watch.droppedWhileTyping == 0, "the keyboard went down")
      }

      @Test func guests_of_very_different_heights_keep_the_typed_line() throws {
        let (screen, line, watch) = try typing(in: 50, of: 60)
        let list = screen.list
        let cell = try #require(line.superview)
        let before = drawnY(of: cell, in: list)
        let long = Array(repeating: "A suggestion with many words that wrap", count: 6).joined(separator: " ")

        // Far off screen above, where the list knows their heights only by its estimates.
        screen.controller.setGuestRows([guest("g1", after: "p2", words: long), guest("g2", after: "p3", words: "Short")])
        let worst = worstDeviation(of: cell, in: list, from: before, for: 0.6)
        #expect(abs(worst) < 0.5, "the line was drawn \(worst) points away")

        // Their heights swapped, the one the list had estimated now six lines tall.
        screen.controller.setGuestRows([guest("g1", after: "p2", words: "Short"), guest("g2", after: "p3", words: long)])
        let again = worstDeviation(of: cell, in: list, from: before, for: 0.6)
        #expect(abs(again) < 0.5, "the line was drawn \(again) points away")
        #expect(line.isFirstResponder)
        #expect(watch.droppedWhileTyping == 0)
      }

      /// A scroll under way (an animated one stands in for a fling, which a test cannot make) when the guests change: it
      /// stops, and the line stays where it was drawn when they came, as for the header (`headerDidChange`).
      @Test func a_guest_change_while_the_list_decelerates_keeps_the_typed_line() throws {
        let (screen, line, watch) = try typing(in: 30, of: 60)
        let list = screen.list
        let cell = try #require(line.superview)
        list.setContentOffset(CGPoint(x: 0, y: list.contentOffset.y + 120), animated: true)
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        let before = drawnY(of: cell, in: list)

        screen.controller.setGuestRows([guest("g1", after: "p20"), guest("g2", after: "p25")])
        let worst = worstDeviation(of: cell, in: list, from: before, for: 0.6)

        #expect(abs(worst) < 0.5, "the line was drawn \(worst) points away")
        #expect(line.isFirstResponder)
        #expect(watch.droppedWhileTyping == 0)
      }

      @Test func without_a_line_typed_in_a_guest_change_animates() throws {
        let screen = try Screen.editing(paragraphs(10))
        screen.controller.setGuestRows([guest("g1", after: "p3")])
        #expect(screen.controller.appliedAnimated.last == true)
        screen.controller.setGuestRows([])
        #expect(screen.controller.appliedAnimated.last == true)
      }

      @Test func guests_changing_while_he_composes_keep_his_marked_text() throws {
        let screen = try Screen.editing(paragraphs(30))
        let list = screen.list
        list.scrollToItem(at: IndexPath(item: 14, section: 0), at: .centeredVertically, animated: false)
        let line = try screen.focus(14)
        _ = screen.wait(0.5) { false }
        let cell = try #require(line.superview as? LineBlockCell)
        for step in ["j", "jin"] {
          line.setMarkedText(step, selectedRange: NSRange(location: (step as NSString).length, length: 0))
        }
        #expect(screen.controller.isComposing)
        let synced = line.syncedText
        let snapshots = screen.controller.appliedSnapshots

        for guests in [
          [guest("g1", after: "p5"), guest("g2", after: "p14"), guest("g3", after: "p20")],
          [guest("g1", after: "p5", words: "Changed words")],
          [],
        ] {
          screen.controller.setGuestRows(guests)
          _ = screen.wait(0.3) { false }
          #expect(!screen.controller.redrawnRows.contains("p15"), "his row was redrawn")
          #expect(line.superview === cell, "the line's cell changed")
          #expect(line.markedTextRange != nil, "the composition ended")
          #expect(line.text == "Line 15jin")
          #expect(line.isFirstResponder)
        }
        #expect(screen.controller.appliedSnapshots == snapshots + 3)
        #expect(line.syncedText == synced)
        line.setMarkedText("今", selectedRange: NSRange(location: 1, length: 0))
        line.unmarkText()
        _ = screen.wait(0.2) { false }
        #expect(try screen.words()[14] == "Line 15今")
      }

      // MARK: the page and its guests together

      @Test func a_page_and_its_guests_in_one_call_swap_a_guest_for_its_row_in_one_update() throws {
        let blocks = dayBlocks(lines: 2)
        let screen = try Screen.editing(blocks, tasks: dayTasks)
        screen.controller.setGuestRows([guest("g1", after: "t2", words: "Pack the charger")])
        #expect(listed(screen) == ["h1", "t1", "n1", "t2", "guest:g1", "b1", "h2", "p1", "p2"])
        let snapshots = screen.controller.appliedSnapshots
        var applied = blocks
        applied.insert(todoRow("t3", "k3", "Pack the charger"), at: 3)
        screen.controller.replace(
          document: Document.write(applied), in: try makeWorkspace(tasks: dayTasks + [openTodo("k3")]), guests: [])
        #expect(screen.controller.appliedSnapshots == snapshots + 1)
        #expect(listed(screen) == ["h1", "t1", "n1", "t2", "t3", "b1", "h2", "p1", "p2"])
      }

      @Test func a_merge_that_takes_the_typed_line_away_with_guests_changing_leaves_the_caret_on_a_line() throws {
        let screen = try Screen.editing(paragraphs(20))
        let line = try screen.focus(9)
        #expect(line.rowID == "p10")
        let without = paragraphs(20).filter { $0.id != "p10" }
        screen.controller.replace(
          document: Document.write(without), in: try makeWorkspace(), guests: [guest("g1", after: "p9")])
        _ = screen.wait(0.3) { false }
        #expect(listed(screen).contains("guest:g1"))
        let caret = try #require(screen.controller.focusedLine, "no line holds the caret")
        #expect(caret.rowID == "p9")
        #expect(screen.holdsKeyboard)
      }

      // MARK: one action at a time

      @Test func the_acting_row_can_be_a_guest() throws {
        let screen = try Screen.editing(paragraphs(3))
        var used: [String] = []
        screen.controller.onGuestAction = { used.append("\($0):\($1)") }
        screen.controller.setGuestRows([guest("g1", after: "p1"), guest("g2", after: "p2")])
        let acting = try guestCell("g1", in: screen)
        let other = try guestCell("g2", in: screen)

        screen.controller.actingRow = "g1"
        screen.window.layoutIfNeeded()
        #expect(try guestCell("g1", in: screen) === acting, "dimmed in place")
        #expect(acting.wordsLabel.textColor == .tertiaryLabel)
        #expect(acting.actionButtons.allSatisfy { $0.configuration?.baseForegroundColor == .tertiaryLabel })
        #expect(other.wordsLabel.textColor == .secondaryLabel)
        #expect(listed(screen) == ["p1", "guest:g1", "p2", "guest:g2", "p3"], "a guest dimmed is still a guest")
        for cell in [acting, other] {
          try #require(cell.button(symbol: "checkmark")).sendActions(for: .primaryActionTriggered)
          let skip = try #require(cell.accessibilityCustomActions?.first { $0.name == "Skip" })
          #expect(skip.actionHandler?(skip) == false)
        }
        // A line's action out holds the guests' too.
        screen.controller.actingRow = "p3"
        try #require(other.button(symbol: "checkmark")).sendActions(for: .primaryActionTriggered)
        #expect(used.isEmpty)

        screen.controller.actingRow = nil
        screen.window.layoutIfNeeded()
        #expect(acting.wordsLabel.textColor == .secondaryLabel)
        try #require(acting.button(symbol: "checkmark")).sendActions(for: .primaryActionTriggered)
        #expect(used == ["g1:apply"])
      }

      @Test func a_guest_has_no_swipe_and_no_menu() throws {
        let screen = try Screen.editing(dayBlocks(lines: 2), tasks: dayTasks, today: today)
        screen.controller.setGuestRows([guest("g1", after: "t2")])
        let provider = try #require(screen.controller.listConfiguration.trailingSwipeActionsConfigurationProvider)
        #expect(provider(IndexPath(item: try item("t2", in: screen), section: 0)) != nil, "his to-do has its swipe")
        #expect(provider(IndexPath(item: try item("guest:g1", in: screen), section: 0)) == nil)
        let cell = try guestCell("g1", in: screen)
        #expect(!cell.interactions.contains { $0 is UIContextMenuInteraction })
        #expect(cell.actionButtons.allSatisfy { $0.menu == nil && !$0.showsMenuAsPrimaryAction })
      }

      @Test(arguments: ["paragraph", "divider"])
      func a_tap_under_the_last_line_with_a_guest_last(lastBlock: String) throws {
        var blocks = paragraphs(2)
        if lastBlock == "divider" { blocks.append(block("d", "divider")) }
        let screen = try Screen.editing(blocks)
        screen.controller.setGuestRows([guest("g1", after: blocks.last?.id)])
        let cell = try guestCell("g1", in: screen)
        #expect(!screen.controller.takesTapUnderTheLastLine(at: CGPoint(x: 100, y: cell.frame.midY)))
        let below = CGPoint(x: 100, y: cell.frame.maxY + 40)
        #expect(screen.controller.takesTapUnderTheLastLine(at: below))
        screen.controller.tapUnderTheLastLine(at: below)
        _ = screen.list
        let caret = try #require(screen.controller.focusedLine)
        if lastBlock == "paragraph" {
          #expect(caret.rowID == "p2")
          #expect(caret.selectedRange.location == ("Line 2" as NSString).length)
          #expect(try screen.words() == ["Line 1", "Line 2"])
        } else {
          // The new paragraph is made after the divider, and so drawn after the guest that follows it.
          #expect(try screen.blocks().count == 4)
          let made = try #require(caret.rowID)
          #expect(listed(screen) == ["p1", "p2", "d", "guest:g1", made])
        }
      }
    }
  }
#endif
