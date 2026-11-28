import DaythreadCore
import DaythreadEditor
import UIKit
import XCTest

/// The list's animated scroll to a row, here because the editor package's tests have no window scene, and without one
/// a scroll view's animation never runs; the app's test host has one.
@MainActor
final class ScrollToRowTests: XCTestCase {
  /// Held to the half point the unanimated scroll is held to. The animated form reads the row once, on the heights
  /// known then; on this page of one-line rows it lands exactly (measured: off by 0), so a miss here is a change in how
  /// the scroll is made, not the estimates' error the doc comment allows on a page of mixed heights.
  func test_an_animated_scroll_to_a_row_puts_it_at_the_top_once_the_animation_ends() throws {
    let scene = try XCTUnwrap(
      UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first, "the test host has a scene")
    let window = UIWindow(windowScene: scene)
    window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
    let controller = DocumentViewController()
    window.rootViewController = controller
    window.makeKeyAndVisible()
    defer { window.isHidden = true }
    let header = UIView()
    let height = header.heightAnchor.constraint(equalToConstant: 100)
    height.priority = .required - 1
    height.isActive = true
    controller.headerView = header
    controller.edit(page: try Self.page(lines: 60), in: try Self.workspace())
    let list = try XCTUnwrap(controller.view as? UICollectionView)
    list.layoutIfNeeded()

    XCTAssertTrue(controller.scroll(toRow: "l40", animated: true))
    // The animation has ended once the list has moved and then stayed where it is for a fifth of a second.
    let end = Date().addingTimeInterval(3)
    var last = list.contentOffset.y
    var still = 0
    while still < 4, Date() < end {
      RunLoop.current.run(until: Date().addingTimeInterval(0.05))
      let offset = list.contentOffset.y
      still = abs(offset - last) < 0.01 && offset > 0 ? still + 1 : 0
      last = offset
    }
    XCTAssertGreaterThanOrEqual(still, 4, "the scroll's animation ended")
    list.layoutIfNeeded()

    let row = try XCTUnwrap(list.layoutAttributesForItem(at: IndexPath(item: 39, section: 0))).frame
    let off = row.minY - (list.contentOffset.y + list.adjustedContentInset.top)
    XCTAssertLessThanOrEqual(abs(off), 0.5)
  }

  private static func page(lines: Int) throws -> Page {
    let blocks = (1...lines).map { n in
      Block(
        id: "l\(n)", type: "paragraph", props: JSONObject(),
        content: .array([.object(["type": .string("text"), "text": .string("Line \(n)"), "styles": .object([:])])]),
        children: [])
    }
    let json: JSONValue = .object([
      "id": .string("p"), "type": .string("document"), "date": .null, "title": .string("A page"),
      "document": .string(Document.write(blocks)),
    ])
    return try XCTUnwrap(Page(json))
  }

  private static func workspace() throws -> Workspace {
    let json: JSONValue = .object([
      "revision": .number("1"), "timezone": .string("UTC"), "pages": .array([]), "tasks": .array([]),
    ])
    return try XCTUnwrap(Workspace(json))
  }
}
