#if canImport(UIKit)
  import DaythreadCore
  import Testing
  import UIKit

  @testable import DaythreadEditor

  @MainActor
  @Suite struct DocumentViewControllerTests {
    /// A controller whose view has a phone's size, laid out.
    private func hosted() -> DocumentViewController {
      let controller = DocumentViewController()
      controller.view.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
      controller.view.layoutIfNeeded()
      return controller
    }

    @Test func theFixturePageIsDrawnWithAsManyItemsAsItHasRows() throws {
      let controller = hosted()
      let page = try EditorFixtures.dayPage()
      let workspace = try EditorFixtures.workspace()
      controller.show(page: page, in: workspace)
      controller.view.layoutIfNeeded()
      #expect(controller.itemCount == BlockRows.rows(for: page, in: workspace).count)
      #expect(controller.itemCount == 26)
    }

    @Test func showingTheSameInputTwiceAppliesNoChange() throws {
      let controller = hosted()
      let page = try EditorFixtures.dayPage()
      let workspace = try EditorFixtures.workspace()
      controller.show(page: page, in: workspace)
      #expect(controller.appliedSnapshots == 1)
      controller.show(page: page, in: workspace)
      #expect(controller.appliedSnapshots == 1)
    }

    @Test func aChangedWorkspaceIsAppliedAndStillDrawsEveryRow() throws {
      let controller = hosted()
      let page = try EditorFixtures.dayPage()
      var workspace = try EditorFixtures.workspace()
      controller.show(page: page, in: workspace)
      workspace.tasks = workspace.tasks.filter { $0.id != "editor-task:d7" }
      controller.show(page: page, in: workspace)
      controller.view.layoutIfNeeded()
      #expect(controller.appliedSnapshots == 2)
      #expect(controller.itemCount == 26)
    }

    @Test func aDocumentThatDoesNotParseShowsNothing() throws {
      let controller = hosted()
      let broken = try #require(
        Page(.object([
          "id": .string("p"), "type": .string("document"), "date": .null, "title": .string("x"),
          "document": .string("[{\"id\":"),
        ])))
      controller.show(page: broken, in: try makeWorkspace())
      controller.view.layoutIfNeeded()
      #expect(controller.itemCount == 0)
      controller.show(page: try EditorFixtures.dayPage(), in: try EditorFixtures.workspace())
      controller.show(page: broken, in: try makeWorkspace())
      controller.view.layoutIfNeeded()
      #expect(controller.itemCount == 0)
    }

    @Test func aDocumentWithARepeatedIdIsDrawnWithoutTrapping() throws {
      let controller = hosted()
      let page = try makePage([block("a", "paragraph", text: "1"), block("a", "paragraph", text: "2")])
      controller.show(page: page, in: try makeWorkspace())
      controller.view.layoutIfNeeded()
      #expect(controller.itemCount == 2)
    }

    @Test func everyKindOfRowMakesACellWithItsAccessibilityLabel() throws {
      let controller = hosted()
      controller.show(page: try EditorFixtures.dayPage(), in: try EditorFixtures.workspace())
      controller.view.layoutIfNeeded()
      let collection = try #require(controller.view as? UICollectionView)
      func cell(_ row: Int) -> UICollectionViewCell? {
        collection.layoutIfNeeded()
        return collection.cellForItem(at: IndexPath(item: row, section: 0))
      }
      #expect(cell(1)?.accessibilityLabel == "Plan")
      #expect(cell(1)?.accessibilityTraits.contains(.header) == true)
      #expect(cell(0)?.accessibilityTraits.contains(.header) == false)
      // A to-do's button is the row's accessibility element, so the cell itself is not one.
      let open = (cell(2) as? TodoBlockCell)?.circle
      let done = (cell(5) as? TodoBlockCell)?.circle
      #expect(open?.accessibilityValue == "not done")
      #expect(done?.accessibilityValue == "done")
      #expect(done?.accessibilityLabel == "Complete Call the dentist")
      #expect(cell(5)?.isAccessibilityElement == false)
    }

    @Test func theWorkspaceDecidesTheCheckmark() throws {
      let controller = hosted()
      controller.show(page: try EditorFixtures.dayPage(), in: try EditorFixtures.workspace())
      let collection = try #require(controller.view as? UICollectionView)
      collection.layoutIfNeeded()
      let open = try #require(collection.cellForItem(at: IndexPath(item: 2, section: 0)) as? TodoBlockCell)
      let done = try #require(collection.cellForItem(at: IndexPath(item: 5, section: 0)) as? TodoBlockCell)
      #expect(open.symbolName == "circle")
      #expect(done.symbolName == "checkmark.circle.fill")
      #expect(open.indentationLevel == 0)
      let nested = try #require(collection.cellForItem(at: IndexPath(item: 4, section: 0)) as? UICollectionViewListCell)
      #expect(nested.indentationLevel == 2)
      #expect(nested.indentationWidth == 20)
    }

    // MARK: a row that changes

    private func collection(_ controller: DocumentViewController) throws -> UICollectionView {
      let collection = try #require(controller.view as? UICollectionView)
      collection.layoutIfNeeded()
      return collection
    }

    private func cell(_ controller: DocumentViewController, _ item: Int) throws -> UICollectionViewCell {
      try #require(try collection(controller).cellForItem(at: IndexPath(item: item, section: 0)))
    }

    private func text(of cell: UICollectionViewCell) -> NSAttributedString? {
      (cell.contentConfiguration as? UIListContentConfiguration)?.attributedText
    }

    @Test(arguments: [
      ("paragraph", "task"), ("task", "paragraph"), ("paragraph", "divider"), ("paragraph", "database"),
      ("divider", "paragraph"), ("database", "task"),
    ])
    func aRowWhoseBlockChangesTypeUnderTheSameIdIsRedrawnAsTheNewKind(from: String, to: String) throws {
      func blocks(_ type: String) -> [Block] {
        let props: JSONObject = type == "task" ? ["taskId": .string("k")] : JSONObject()
        return [
          block("first", "paragraph", text: "first"),
          block("changing", type, props, text: ["divider", "database"].contains(type) ? nil : "changing"),
          block("last", "paragraph", text: "last"),
        ]
      }
      let controller = hosted()
      let workspace = try makeWorkspace(tasks: [taskJSON("k", status: "open")])
      controller.show(page: try makePage(blocks(from)), in: workspace)
      _ = try collection(controller)
      controller.show(page: try makePage(blocks(to)), in: workspace)
      let list = try collection(controller)
      #expect(controller.itemCount == 3)
      let changed = try cell(controller, 1)
      switch to {
      case "task": #expect(changed is TodoBlockCell)
      case "paragraph": #expect(changed is TextBlockCell)
      case "divider": #expect(changed is SeparatorBlockCell)
      default: #expect(changed is PlaceholderBlockCell)
      }
      switch to {
      case "paragraph": #expect(changed.accessibilityLabel == "changing")
      case "task": #expect((changed as? TodoBlockCell)?.circle.accessibilityLabel == "Complete changing")
      case "database": #expect(changed.accessibilityLabel == "Database")
      default: break
      }
      #expect(list.numberOfItems(inSection: 0) == 3)
    }

    @Test func aChangedToDoIsRedrawnAndAnUntouchedRowIsLeftAlone() throws {
      let controller = hosted()
      let page = try EditorFixtures.dayPage()
      var workspace = try EditorFixtures.workspace()
      controller.show(page: page, in: workspace)
      let before = try #require(try cell(controller, 2) as? TodoBlockCell)
      let untouched = try cell(controller, 0)
      #expect(before.circle.accessibilityValue == "not done")
      #expect(before.symbolName == "circle")

      let index = try #require(workspace.tasks.firstIndex { $0.id == "editor-task:d3" })
      var raw = try #require(workspace.tasks[index].raw["status"] != nil ? workspace.tasks[index].raw : nil)
      raw["status"] = .string("done")
      workspace.tasks[index] = try #require(TodoTask(.object(raw)))
      controller.show(page: page, in: workspace)

      let after = try #require(try cell(controller, 2) as? TodoBlockCell)
      #expect(after.circle.accessibilityValue == "done")
      #expect(after.symbolName == "checkmark.circle.fill")
      let drawn = try #require(text(of: after))
      #expect(drawn.attribute(.strikethroughStyle, at: 0, effectiveRange: nil) as? Int == NSUnderlineStyle.single.rawValue)
      #expect(try cell(controller, 0) === untouched)
    }

    /// A day without a page puts what it says behind an empty list: nothing the list draws may hide it.
    @Test func nothing_the_list_draws_covers_its_background_view() throws {
      let controller = DocumentViewController()
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
      window.rootViewController = controller
      window.makeKeyAndVisible()
      controller.view.layoutIfNeeded()
      controller.show(page: try EditorFixtures.dayPage(), in: try EditorFixtures.workspace())
      _ = try collection(controller)
      controller.show(page: try makePage([]), in: try makeWorkspace())
      let list = try collection(controller)
      let behind = UIView()
      list.backgroundView = behind
      list.layoutIfNeeded()
      let shown = behind.convert(behind.bounds, to: list)
      let over = list.subviews.drop { $0 !== behind }.dropFirst()
        .filter { !$0.isHidden && $0.alpha > 0 && $0.frame.intersects(shown) }
        .filter { view in
          var alpha: CGFloat = 0
          view.backgroundColor?.getWhite(nil, alpha: &alpha)
          return alpha > 0
        }
      #expect(over.isEmpty, "covered by \(over.map { "\(type(of: $0)) \($0.frame)" })")
    }

    /// A tick the server holds goes back to open: the words are told to lose the line through them outright. A label
    /// given text that leaves the attribute out keeps the line it drew (seen on the simulator), so "no line" is
    /// written as 0, not left out. What the label shows is checked on the simulator: in a test the list's animated
    /// redraw never finishes, so the label there still holds the old text whatever the cell is told.
    @Test func a_done_to_do_drawn_open_again_has_no_line_through_its_words() throws {
      let controller = hosted()
      let page = try makePage([block("a", "task", ["taskId": .string("k")], text: "Call the bank")])
      controller.show(page: page, in: try makeWorkspace(tasks: [taskJSON("k", status: "done")]))
      let done = try #require(text(of: try cell(controller, 0)))
      #expect(done.attribute(.strikethroughStyle, at: 0, effectiveRange: nil) as? Int == NSUnderlineStyle.single.rawValue)
      controller.show(page: page, in: try makeWorkspace(tasks: [taskJSON("k", status: "open")]))
      let cell = try #require(try self.cell(controller, 0) as? TodoBlockCell)
      #expect(cell.symbolName == "circle")
      let open = try #require(text(of: cell))
      #expect(open.attribute(.strikethroughStyle, at: 0, effectiveRange: nil) as? Int == 0)
    }

    /// Another day's page is not a diff of the one before: its rows appear, they do not slide in.
    @Test func another_page_is_drawn_without_animation_and_the_same_page_with_it() throws {
      let controller = hosted()
      let tasks = [taskJSON("k", status: "open")]
      let monday = try makePage([block("a", "task", ["taskId": .string("k")], text: "Water")], id: "day:2026-11-23")
      let mondayTicked = try makeWorkspace(tasks: [taskJSON("k", status: "done")])
      let tuesday = try makePage([block("b", "paragraph", text: "Rest")], id: "day:2026-11-24")
      controller.show(page: monday, in: try makeWorkspace(tasks: tasks))
      controller.show(page: monday, in: mondayTicked)
      controller.show(page: tuesday, in: mondayTicked)
      controller.show(page: tuesday, in: try makeWorkspace(tasks: tasks))
      let tuesdayEdited = try makePage([block("b", "paragraph", text: "Rest well")], id: "day:2026-11-24")
      controller.show(page: tuesdayEdited, in: mondayTicked)
      #expect(controller.appliedAnimated == [false, true, false, true])
    }

    @Test func aRowWhoseTextChangedButNotItsKindIsReconfiguredInPlace() throws {
      let controller = hosted()
      let workspace = try makeWorkspace()
      controller.show(
        page: try makePage([block("a", "paragraph", text: "one"), block("b", "paragraph", text: "two")]),
        in: workspace)
      let first = try cell(controller, 0)
      let second = try cell(controller, 1)
      controller.show(
        page: try makePage([block("a", "paragraph", text: "one, changed"), block("b", "paragraph", text: "two")]),
        in: workspace)
      let after = try cell(controller, 0)
      #expect(after === first)
      #expect(try cell(controller, 1) === second)
      #expect(text(of: after)?.string == "one, changed")
      #expect(after.accessibilityLabel == "one, changed")
    }

    // MARK: the circle is a button

    private func circle(_ controller: DocumentViewController, _ item: Int) throws -> UIButton {
      try #require(try cell(controller, item) as? TodoBlockCell).circle
    }

    @Test func tapping_the_circle_reports_the_to_do() throws {
      let controller = hosted()
      controller.show(page: try EditorFixtures.dayPage(), in: try EditorFixtures.workspace())
      var ticked: [String] = []
      controller.onTick = { ticked.append($0) }
      try circle(controller, 2).sendActions(for: .primaryActionTriggered)
      #expect(ticked == ["editor-task:d3"])
    }

    /// A finger on the circle reaches the circle: nothing the cell draws lies over it.
    @Test func a_touch_on_the_circle_lands_on_the_circle() throws {
      let controller = DocumentViewController()
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
      window.rootViewController = controller
      window.makeKeyAndVisible()
      controller.view.layoutIfNeeded()
      controller.show(page: try EditorFixtures.dayPage(), in: try EditorFixtures.workspace())
      let list = try collection(controller)
      list.layoutIfNeeded()
      let button = try circle(controller, 2)
      button.superview?.layoutIfNeeded()
      let center = button.convert(CGPoint(x: button.bounds.midX, y: button.bounds.midY), to: window)
      let hit = try #require(window.hitTest(center, with: nil))
      #expect(hit === button || hit.isDescendant(of: button), "the touch lands on \(type(of: hit))")
    }

    @Test func a_circle_that_cannot_be_ticked_is_disabled_and_reports_nothing() throws {
      let controller = hosted()
      let blocks = [
        block("a", "task", ["taskId": .string("c")], text: "cancelled"),
        block("b", "task", ["taskId": .string("gone")], text: "absent"),
        block("c", "task", ["taskId": .string("o")], text: "open"),
      ]
      controller.show(
        page: try makePage(blocks),
        in: try makeWorkspace(tasks: [taskJSON("c", status: "cancelled"), taskJSON("o", status: "open")]))
      var ticked: [String] = []
      controller.onTick = { ticked.append($0) }
      for item in 0...1 {
        let button = try circle(controller, item)
        #expect(button.isEnabled == false)
        button.sendActions(for: .primaryActionTriggered)
      }
      #expect(try circle(controller, 2).isEnabled)
      #expect(ticked.isEmpty)
    }

    @Test func showing_the_ticked_workspace_in_the_same_turn_draws_it_done() throws {
      let controller = hosted()
      let page = try EditorFixtures.dayPage()
      let workspace = try EditorFixtures.workspace()
      controller.show(page: page, in: workspace)
      _ = try collection(controller)
      controller.onTick = { taskId in
        let ticked = workspace.predicting(Command.taskStatus(taskId: taskId, status: .done, today: nil))
        controller.show(page: page, in: ticked)
      }
      let cell = try #require(try self.cell(controller, 2) as? TodoBlockCell)
      #expect(cell.symbolName == "circle")
      cell.circle.sendActions(for: .primaryActionTriggered)
      _ = try collection(controller)
      let after = try #require(try self.cell(controller, 2) as? TodoBlockCell)
      #expect(after.symbolName == "checkmark.circle.fill")
      #expect(after.circle.accessibilityValue == "done")
      // What is drawn, not what `configure` stored: the button's own image.
      let expected = try #require(UIImage(systemName: "checkmark.circle.fill"))
      #expect(after.circle.configuration?.image?.isEqual(expected) == true)
    }

    /// The gap between the glyph's right edge and the text's left edge, with the content size category given.
    private func glyphToTextGap(_ category: UIContentSizeCategory) throws -> (gap: CGFloat, button: CGSize, glyph: CGSize) {
      let controller = DocumentViewController()
      // In a window, so the category reaches the cells' trait collections.
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
      window.traitOverrides.preferredContentSizeCategory = category
      window.rootViewController = controller
      window.makeKeyAndVisible()
      controller.view.layoutIfNeeded()
      controller.show(page: try EditorFixtures.dayPage(), in: try EditorFixtures.workspace())
      let list = try collection(controller)
      list.layoutIfNeeded()
      let cell = try #require(try self.cell(controller, 2) as? TodoBlockCell)
      cell.layoutIfNeeded()
      let glyph = try #require(cell.circle.imageView)
      let label = try #require(allSubviews(cell).compactMap { $0 as? UILabel }.first { $0.text?.isEmpty == false })
      let glyphEdge = glyph.convert(glyph.bounds, to: list).maxX
      return (label.convert(label.bounds, to: list).minX - glyphEdge, cell.circle.bounds.size, glyph.bounds.size)
    }

    @Test func at_the_largest_text_size_the_glyph_does_not_reach_the_text_and_the_button_is_still_44_square() throws {
      let normal = try glyphToTextGap(.large)
      let largest = try glyphToTextGap(.accessibilityExtraExtraExtraLarge)
      // Without this the two measurements could be the same layout and the rest would check nothing.
      #expect(largest.glyph.width > normal.glyph.width * 1.5, "the larger category did not reach the cells")
      #expect(largest.gap >= 0, "the glyph overlaps the text")
      // The system's own layout of a row's image: its slot hugs the larger glyph, and the words keep their padding.
      let padding = UIListContentConfiguration.cell().imageToTextPadding
      #expect(largest.gap >= padding - 0.5, "gap \(largest.gap) at the largest size, padding \(padding)")
      #expect(normal.gap >= padding - 0.5, "gap \(normal.gap) at the default size, padding \(padding)")
      #expect(largest.button.width >= 44 && largest.button.height >= 44)
    }

    /// Where a to-do's circle is drawn beside a paragraph, in the list's coordinates, in a window `width` wide with
    /// `safeArea` points of horizontal safe area on each side.
    private func circleLayout(width: CGFloat, safeArea: CGFloat, regular: Bool) throws -> (
      glyph: CGRect, guide: CGRect?, words: CGRect, paragraph: CGRect
    ) {
      let controller = DocumentViewController()
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 844))
      if regular { window.traitOverrides.horizontalSizeClass = .regular }
      window.rootViewController = controller
      window.makeKeyAndVisible()
      controller.additionalSafeAreaInsets = UIEdgeInsets(top: 0, left: safeArea, bottom: 0, right: safeArea)
      controller.view.layoutIfNeeded()
      controller.show(
        page: try makePage([
          block("a", "paragraph", text: "Plain words"), block("b", "task", ["taskId": .string("k")], text: "Water the plants"),
        ]),
        in: try makeWorkspace(tasks: [taskJSON("k", status: "open")]))
      let list = try collection(controller)
      #expect(list.safeAreaInsets.left == safeArea, "the inset did not reach the list")
      let todo = try #require(try cell(controller, 1) as? TodoBlockCell)
      todo.layoutIfNeeded()
      func words(_ cell: UICollectionViewCell) throws -> CGRect {
        let label = try #require(allSubviews(cell).compactMap { $0 as? UILabel }.first { $0.text?.isEmpty == false })
        return label.convert(label.bounds, to: list)
      }
      let glyph = try #require(todo.circle.imageView)
      let guide = (todo.contentView as? UIListContentView)?.imageLayoutGuide.map {
        todo.contentView.convert($0.layoutFrame, to: list)
      }
      return (glyph.convert(glyph.bounds, to: list), guide, try words(todo), try words(try cell(controller, 0)))
    }

    /// The circle sits where the system puts a row's image: at the words' leading edge, inside the safe area and the
    /// margins of a regular width as much as in portrait on a phone.
    @Test(arguments: [(390, 0, false), (844, 62, false), (1024, 0, true)] as [(CGFloat, CGFloat, Bool)])
    func the_circle_sits_in_its_rows_image_slot(width: CGFloat, safeArea: CGFloat, regular: Bool) throws {
      let layout = try circleLayout(width: width, safeArea: safeArea, regular: regular)
      #expect(
        layout.glyph.minX >= layout.paragraph.minX - 1 && layout.glyph.minX <= layout.paragraph.minX + 4,
        "glyph at \(layout.glyph.minX), a paragraph's words at \(layout.paragraph.minX)")
      #expect(layout.glyph.maxX < layout.words.minX, "the glyph reaches the words")
      let guide = try #require(layout.guide, "the row has no image slot")
      #expect(abs(layout.glyph.midX - guide.midX) <= 1, "glyph centre \(layout.glyph.midX), slot centre \(guide.midX)")
      #expect(abs(layout.glyph.midY - guide.midY) <= 1, "glyph centre \(layout.glyph.midY), slot centre \(guide.midY)")
    }

    /// The colour the circle's glyph is drawn in, as the button resolves it for its state now.
    private func glyphColour(_ button: UIButton) throws -> UIColor {
      button.updateConfiguration()
      button.layoutIfNeeded()
      return try #require(button.imageView?.tintColor).resolvedColor(with: button.traitCollection)
    }

    @Test func a_touch_on_the_circle_shows_the_systems_pressed_look() throws {
      let controller = hosted()
      controller.show(
        page: try makePage([block("a", "task", ["taskId": .string("o")], text: "open")]),
        in: try makeWorkspace(tasks: [taskJSON("o", status: "open")]))
      let button = try circle(controller, 0)
      let normal = try glyphColour(button)
      button.isHighlighted = true
      let pressed = try glyphColour(button)
      #expect(pressed != normal, "pressed \(pressed), normal \(normal)")
    }

    @Test func a_circle_that_cannot_be_ticked_keeps_the_look_of_its_status() throws {
      let controller = hosted()
      controller.show(
        page: try makePage([block("a", "task", ["taskId": .string("c")], text: "cancelled")]),
        in: try makeWorkspace(tasks: [taskJSON("c", status: "cancelled")]))
      let button = try circle(controller, 0)
      #expect(!button.isEnabled)
      let disabled = try glyphColour(button)
      button.isEnabled = true
      let enabled = try glyphColour(button)
      #expect(disabled == enabled, "disabled \(disabled), as it would be drawn enabled \(enabled)")
    }

    @Test func the_button_is_at_least_44_points_square() throws {
      let controller = hosted()
      controller.show(page: try EditorFixtures.dayPage(), in: try EditorFixtures.workspace())
      _ = try collection(controller)
      let button = try circle(controller, 2)
      #expect(button.bounds.width >= 44)
      #expect(button.bounds.height >= 44)
    }

    // MARK: nesting

    private func allSubviews(_ view: UIView) -> [UIView] {
      view.subviews + view.subviews.flatMap { allSubviews($0) }
    }

    /// The leading edge, in the list's coordinates, of what a cell shows: its text, or for a divider its line.
    private func leadingEdge(of kind: String, at item: Int, in controller: DocumentViewController) throws -> CGFloat {
      let list = try collection(controller)
      let cell = try cell(controller, item)
      let views = allSubviews(cell)
      let target: UIView?
      switch kind {
      case "divider": target = views.first { $0.bounds.height < 2 && $0.bounds.width > 100 }
      default:
        target = views.compactMap { $0 as? UILabel }.first
      }
      let view = try #require(target, "no content for \(kind) at \(item)")
      return view.convert(view.bounds, to: list).minX
    }

    private func markerEdge(at item: Int, in controller: DocumentViewController) throws -> CGFloat {
      let list = try collection(controller)
      let images = allSubviews(try cell(controller, item)).compactMap { $0 as? UIImageView }
      let marker = try #require(images.first)
      return marker.convert(marker.bounds, to: list).minX
    }

    @Test(arguments: ["bulletListItem", "numberedListItem", "paragraph", "heading", "quote", "task", "divider", "database"])
    func aNestedRowIsIndentedTwentyPointsPerDepth(kind: String) throws {
      func make(_ id: String) -> Block {
        let props: JSONObject = kind == "task" ? ["taskId": .string("k")] : JSONObject()
        return block(id, kind, props, text: ["divider", "database"].contains(kind) ? nil : "some words here")
      }
      let blocks = [
        make("k0"),
        block("p", "bulletListItem", text: "parent", children: [
          make("k1"),
          block("q", "bulletListItem", text: "child", children: [make("k2")]),
        ]),
      ]
      let controller = hosted()
      controller.show(
        page: try makePage(blocks), in: try makeWorkspace(tasks: [taskJSON("k", status: "open")]))
      _ = try collection(controller)
      // Rows: k0, p, k1, q, k2.
      let root = try leadingEdge(of: kind, at: 0, in: controller)
      let one = try leadingEdge(of: kind, at: 2, in: controller)
      let two = try leadingEdge(of: kind, at: 4, in: controller)
      #expect(abs(one - root - 20) <= 0.5, "depth 1: \(one - root)")
      #expect(abs(two - root - 40) <= 0.5, "depth 2: \(two - root)")
      if kind == "bulletListItem" {
        let marker = try markerEdge(at: 1, in: controller)
        #expect(abs(try markerEdge(at: 2, in: controller) - marker - 20) <= 0.5)
        #expect(abs(try markerEdge(at: 3, in: controller) - marker - 20) <= 0.5)
        #expect(abs(try markerEdge(at: 4, in: controller) - marker - 40) <= 0.5)
      }
    }
  }
#endif
