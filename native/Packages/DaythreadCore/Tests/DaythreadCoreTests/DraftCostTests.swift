import Foundation
import Testing

@testable import DaythreadCore

/// What the index and the draft view cost on a large workspace: printed, not asserted (a number for the next cost
/// task to start from). Run with `DAYTHREAD_MEASURE=1 swift test --filter DraftCostTests`, in Debug as the app's tests.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["DAYTHREAD_MEASURE"] != nil))
struct DraftCostTests {
  @Test func the_index_and_the_draft_view_on_a_large_workspace() throws {
    let plain = try Self.workspace(drafts: 0, openLine: false)
    let withDrafts = try Self.workspace(drafts: 365, openLine: true)
    let withoutLine = try Self.workspace(drafts: 365, openLine: false)
    #expect(plain.tasks.count == 3_000)
    #expect(plain.pages.count == 302)

    print("index, 3,000 to-dos on 300 pages: \(Self.median { _ = TodoIndex(plain) }) ms")
    print("index, the same with 365 drafts of 20 items: \(Self.median { _ = TodoIndex(withDrafts) }) ms")
    for (name, workspace) in [("one open line", withDrafts), ("no open line", withoutLine)] {
      let index = TodoIndex(workspace)
      let page = try #require(workspace.page("day:2026-11-26"))
      #expect(DraftView.of(page: page, in: workspace, index: index) != nil)
      let time = Self.median { _ = DraftView.of(page: page, in: workspace, index: index) }
      print("draft view, 365 drafts, \(name): \(time) ms")
    }
  }

  /// Five runs; the median in milliseconds.
  private static func median(_ work: () -> Void) -> String {
    let clock = ContinuousClock()
    let runs = (0..<5).map { _ in clock.measure(work) }.sorted()
    let ms = Double(runs[2].components.attoseconds) / 1e15 + Double(runs[2].components.seconds) * 1000
    return String(format: "%.1f", ms)
  }

  /// 300 past day pages, oldest first, each a heading, 10 plan rows and a `Gym` line; today's page last. With
  /// `drafts`, that many past days' drafts of 20 decided items each (half carried to-dos, half lines, one of the lines
  /// an older recipe's `Gym`); today's draft offers 5 to-dos and, with `openLine`, a `Gym` carried from yesterday.
  private static func workspace(drafts: Int, openLine: Bool) throws -> Workspace {
    let today = try #require(LocalDate("2026-11-26"))
    let past = (1...365).compactMap { today.adding(days: -$0) }
    var pages: [JSONValue] = []
    var tasks: [JSONValue] = []
    for (number, day) in past.prefix(300).reversed().enumerated() {
      var blocks = [Block(id: "h-\(day.value)", type: "heading", props: ["level": .number("2")])]
      for row in 0..<10 {
        let id = "todo-\(number * 10 + row)"
        tasks.append(TestWorkspace.task(id, title: "To-do \(id)", createdOn: day.value))
        blocks.append(
          Block(
            id: "row-\(id)", type: "task", props: ["taskId": .string(id), "role": .string("plan")],
            content: .array([.object(textRun("To-do \(id)"))])))
      }
      blocks.append(Block(id: "gym-\(day.value)", type: "bulletListItem", content: .array([.object(textRun("Gym"))])))
      pages.append(TestWorkspace.day(day.value, rows: blocks))
    }
    for (number, day) in past.prefix(drafts).enumerated() {
      var items: [String] = []
      for k in 0..<10 {
        let state = k % 2 == 0 ? "skipped" : "applied"
        items.append(#"{"id":"t\#(k)","anchor":"","taskId":"todo-\#((number * 10 + k) % 3_000)","state":"\#(state)"}"#)
      }
      for k in 0..<10 {
        let words = k == 0 ? "Gym" : "Line \(k) of \(day.value)"
        let from = k == 0 ? "" : #","from":"line-\#(day.value)-\#(k)","recipe":5"#
        items.append(
          #"{"id":"l\#(k)","anchor":"","state":"skipped","block":{"id":"b\#(k)","type":"bulletListItem","props":{},"#
            + #""content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}\#(from)}"#)
      }
      pages.append(
        TestWorkspace.page(
          "draft:day:\(day.value)", type: "draft", parentId: "day:\(day.value)",
          document: #"{"status":"ready","recipe":4,"items":[\#(items.joined(separator: ","))],"moreOpen":[]}"#))
    }
    pages.append(TestWorkspace.day(today.value, rows: [Block(id: "h", type: "heading")]))
    var open = (0..<5).map { #"{"id":"o\#($0)","anchor":"h","taskId":"todo-\#(2_990 + $0)","state":"open"}"# }
    if openLine {
      open.append(
        #"{"id":"gym","anchor":"h","state":"open","from":"gym-2026-11-25","block":{"id":"g","type":"bulletListItem","#
          + #""props":{},"content":[{"type":"text","text":"Gym","styles":{}}],"children":[]}}"#)
    }
    pages.append(
      TestWorkspace.page(
        "draft:day:2026-11-26", type: "draft", parentId: "day:2026-11-26",
        document: #"{"status":"ready","recipe":5,"items":[\#(open.joined(separator: ","))],"moreOpen":[]}"#))
    return try TestWorkspace.make(pages: pages, tasks: tasks)
  }
}
