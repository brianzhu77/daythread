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
  }
#endif
