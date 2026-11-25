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
      #expect(cell(2)?.accessibilityValue == "not done")
      #expect(cell(5)?.accessibilityValue == "done")
      #expect(cell(5)?.accessibilityLabel == "Call the dentist")
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
      case "task", "paragraph": #expect(changed.accessibilityLabel == "changing")
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
      #expect(before.accessibilityValue == "not done")
      #expect(before.symbolName == "circle")

      let index = try #require(workspace.tasks.firstIndex { $0.id == "editor-task:d3" })
      var raw = try #require(workspace.tasks[index].raw["status"] != nil ? workspace.tasks[index].raw : nil)
      raw["status"] = .string("done")
      workspace.tasks[index] = try #require(TodoTask(.object(raw)))
      controller.show(page: page, in: workspace)

      let after = try #require(try cell(controller, 2) as? TodoBlockCell)
      #expect(after.accessibilityValue == "done")
      #expect(after.symbolName == "checkmark.circle.fill")
      let drawn = try #require(text(of: after))
      #expect(drawn.attribute(.strikethroughStyle, at: 0, effectiveRange: nil) != nil)
      #expect(try cell(controller, 0) === untouched)
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
