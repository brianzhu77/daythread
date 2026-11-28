#if canImport(UIKit)
  import DaythreadCore
  import Testing
  import UIKit

  @testable import DaythreadEditor

  private let today = "2026-11-26"

  private func todo(_ id: String, deadlineOn: String? = nil) -> JSONValue {
    var object = JSONObject()
    object["id"] = .string(id)
    object["title"] = .string("A to-do")
    object["status"] = .string("open")
    object["paused"] = .bool(false)
    object["deadlineOn"] = deadlineOn.map { .string($0) } ?? .null
    object["attentionOn"] = .null
    return .object(object)
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

  private func row(_ id: String, _ taskId: String) -> Block {
    var props = JSONObject()
    props["taskId"] = .string(taskId)
    props["role"] = .string("plan")
    props["planDate"] = .string(today)
    return block(id, "task", props, text: "Pay the rent")
  }

  extension OnScreen {
    /// The index the screen builds once and hands to the list: the list reads its rows' facts with it and builds none.
    @MainActor
    @Suite struct IndexTests {
      /// A list that has drawn nothing yet, with today set.
      private func emptyScreen() -> Screen {
        let controller = DocumentViewController()
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.layoutIfNeeded()
        controller.today = LocalDate(today)
        return Screen(window: window, controller: controller)
      }

      private func marks(_ screen: Screen) throws -> String? {
        let cell = try #require(try screen.cell(0) as? TodoBlockCell)
        return (cell.contentConfiguration as? UIListContentConfiguration)?.secondaryAttributedText?.string
      }

      private func workspace(page: Page, repeating: Bool, deadlineOn: String? = nil) throws -> Workspace {
        try makeWorkspace(
          pages: [page], tasks: [todo("k", deadlineOn: deadlineOn)],
          rest: repeating ? [("todoRepeats", .array([weekly("k")]))] : [])
      }

      @Test func an_index_handed_over_is_the_one_the_rows_read() throws {
        let page = try makePage([row("r", "k")], id: "day:\(today)", date: today, type: "daily")
        let now = try workspace(page: page, repeating: false, deadlineOn: today)
        let screen = emptyScreen()
        screen.controller.edit(page: page, in: now, index: TodoIndex(now))
        #expect(screen.controller.indexesBuilt == 0)
        #expect(try marks(screen) == "Due today")

        // The rows read their facts from the index they are handed, not from one of their own: this index is of a
        // workspace whose to-do repeats (a pair no screen would hand over; the only way to tell the two apart).
        let repeating = try workspace(page: page, repeating: true, deadlineOn: today)
        screen.controller.replace(document: page.document, in: now, index: TodoIndex(repeating))
        #expect(screen.controller.indexesBuilt == 0)
        #expect(try marks(screen)?.contains("Repeats") == true)
        #expect(try marks(screen)?.contains("Due today") == true)

        // The same workspace again, with its own index, draws it as before.
        screen.controller.replace(document: page.document, in: now, index: TodoIndex(now))
        #expect(screen.controller.indexesBuilt == 0)
        #expect(try marks(screen) == "Due today")
      }

      @Test func a_page_shown_and_a_new_today_read_the_index_last_handed() throws {
        let page = try makePage([row("r", "k")], id: "day:\(today)", date: today, type: "daily")
        let now = try workspace(page: page, repeating: false, deadlineOn: "2026-11-27")
        let screen = emptyScreen()
        screen.controller.show(page: page, in: now, index: TodoIndex(now))
        #expect(try marks(screen) == "Due tomorrow")
        screen.controller.today = LocalDate("2026-11-27")
        screen.window.layoutIfNeeded()
        #expect(try marks(screen) == "Due today")
        #expect(screen.controller.indexesBuilt == 0, "a new today builds no index")
      }

      @Test func without_an_index_the_list_builds_one_as_before() throws {
        let page = try makePage([row("r", "k")], id: "day:\(today)", date: today, type: "daily")
        let now = try workspace(page: page, repeating: false, deadlineOn: today)
        let screen = emptyScreen()
        screen.controller.edit(page: page, in: now)
        #expect(screen.controller.indexesBuilt == 1)
        #expect(try marks(screen) == "Due today")
        screen.controller.replace(document: page.document, in: now)
        #expect(screen.controller.indexesBuilt == 1, "the same workspace is read again at no cost")
        let other = try workspace(page: page, repeating: true, deadlineOn: today)
        screen.controller.replace(document: page.document, in: other)
        #expect(screen.controller.indexesBuilt == 2)
      }
    }
  }
#endif
