import DaythreadCore
import Foundation
import Testing

@testable import DaythreadEditor

@Suite struct BlockRowsTests {
  @Test func rowsOfTheDayWithEverythingFixtureInOrder() throws {
    let rows = BlockRows.rows(for: try EditorFixtures.dayPage(), in: try EditorFixtures.workspace())
    let expected: [(String, BlockRow.Kind, Int)] = [
      ("d1", .text(style: .paragraph), 0),
      ("d2", .text(style: .heading(level: 2)), 0),
      ("d3", .todo(taskId: "editor-task:d3", status: .open, paused: false), 0),
      ("d4", .todo(taskId: "editor-task:d4", status: .open, paused: false), 1),
      ("d5", .todo(taskId: "editor-task:d5", status: .open, paused: false), 2),
      ("d6", .todo(taskId: "editor-task:d6", status: .done, paused: false), 0),
      ("d7", .todo(taskId: "editor-task:d7", status: .open, paused: false), 0),
      ("d8", .text(style: .heading(level: 1)), 0),
      ("d9", .text(style: .numbered(1)), 0),
      ("d10", .text(style: .numbered(2)), 0),
      ("d11", .text(style: .bullet), 0),
      ("d12", .text(style: .numbered(1)), 0),
      ("d13", .text(style: .quote), 0),
      ("d14", .separator, 0),
      ("d15", .text(style: .heading(level: 3)), 0),
      ("d16", .text(style: .paragraph), 0),
      ("d17", .text(style: .paragraph), 0),
      ("d18", .text(style: .paragraph), 0),
      ("d19", .placeholder(name: "Page"), 0),
      ("d20", .todo(taskId: "editor-task:d20", status: nil, paused: false), 0),
      ("d21", .placeholder(name: "Database"), 0),
      ("d22", .placeholder(name: "Synced block"), 0),
      ("d23", .placeholder(name: "Button"), 0),
      ("d24", .placeholder(name: "Smart note"), 0),
      ("d25", .placeholder(name: "Image"), 0),
      ("d26", .placeholder(name: "File"), 0),
    ]
    #expect(rows.map(\.id) == expected.map(\.0))
    #expect(rows.map(\.kind) == expected.map(\.1))
    #expect(rows.map(\.depth) == expected.map(\.2))
  }

  @Test func aRowCarriesTheContentOfItsBlock() throws {
    let rows = BlockRows.rows(for: try EditorFixtures.dayPage(), in: try EditorFixtures.workspace())
    #expect(InlineText.plain(rows[0].content, pageDate: nil) == "A top-level paragraph before any heading")
    #expect(rows.first { $0.id == "d14" }?.content == nil)
    #expect(rows.first { $0.id == "d21" }?.content == nil)
  }

  @Test func numberingRestartsAfterANonNumberedSibling() throws {
    let blocks = [
      block("a", "numberedListItem", text: "a"), block("b", "numberedListItem", text: "b"),
      block("c", "paragraph", text: "c"), block("d", "numberedListItem", text: "d"),
      block("e", "numberedListItem", text: "e", children: [
        block("e1", "numberedListItem", text: "e1"), block("e2", "numberedListItem", text: "e2"),
      ]),
      block("f", "numberedListItem", text: "f"),
    ]
    let rows = BlockRows.rows(for: try makePage(blocks), in: try makeWorkspace())
    #expect(rows.map(\.kind) == [
      .text(style: .numbered(1)), .text(style: .numbered(2)), .text(style: .paragraph),
      .text(style: .numbered(1)), .text(style: .numbered(2)),
      .text(style: .numbered(1)), .text(style: .numbered(2)), .text(style: .numbered(3)),
    ])
    #expect(rows.map(\.id) == ["a", "b", "c", "d", "e", "e1", "e2", "f"])
    #expect(rows.map(\.depth) == [0, 0, 0, 0, 0, 1, 1, 0])
  }

  @Test func aToDoTakesItsStatusFromItsTaskNotFromTheRow() throws {
    let blocks = [
      block("t1", "task", ["taskId": .string("k1")], text: "one"),
      block("t2", "task", ["taskId": .string("k2")], text: "two"),
      block("t3", "task", ["taskId": .string("k3")], text: "three"),
      block("t4", "task", ["taskId": .string("absent")], text: "four"),
      block("t5", "task", text: "no task id"),
    ]
    let workspace = try makeWorkspace(tasks: [
      taskJSON("k1", status: "done"), taskJSON("k2", status: "cancelled", paused: true),
      taskJSON("k3", status: "open"),
    ])
    let rows = BlockRows.rows(for: try makePage(blocks), in: workspace)
    #expect(rows.map(\.kind) == [
      .todo(taskId: "k1", status: .done, paused: false), .todo(taskId: "k2", status: .cancelled, paused: true),
      .todo(taskId: "k3", status: .open, paused: false), .todo(taskId: "absent", status: nil, paused: false),
      .todo(taskId: "", status: nil, paused: false),
    ])
  }

  @Test func a_to_do_row_carries_its_to_dos_id() throws {
    let blocks = [block("b1", "task", ["taskId": .string("k1")], text: "one")]
    let rows = BlockRows.rows(for: try makePage(blocks), in: try makeWorkspace(tasks: [taskJSON("k1", status: "open")]))
    #expect(rows.map(\.id) == ["b1"])
    #expect(rows.map(\.kind) == [.todo(taskId: "k1", status: .open, paused: false)])
  }

  @Test func a_row_can_be_ticked_only_when_open_or_done() throws {
    let blocks = ["o", "d", "c", "w", "gone"].map { block("b-\($0)", "task", ["taskId": .string($0)], text: $0) }
    let workspace = try makeWorkspace(tasks: [
      taskJSON("o", status: "open"), taskJSON("d", status: "done"), taskJSON("c", status: "cancelled"),
      taskJSON("w", status: "waiting"),
    ])
    let rows = BlockRows.rows(for: try makePage(blocks + [block("p", "paragraph", text: "x")]), in: workspace)
    #expect(rows.map(\.canBeTicked) == [true, true, false, false, false, false])
  }

  @Test func aToDoRowIgnoresAStatusWrittenOnTheBlock() throws {
    let blocks = [block("t", "task", ["taskId": .string("k"), "checked": .bool(true), "status": .string("done")])]
    let rows = BlockRows.rows(for: try makePage(blocks), in: try makeWorkspace(tasks: [taskJSON("k", status: "open")]))
    #expect(rows.map(\.kind) == [.todo(taskId: "k", status: .open, paused: false)])
  }

  @Test(arguments: [
    ("database", "Database"), ("pageLink", "Page"), ("image", "Image"), ("file", "File"),
    ("button", "Button"), ("smartNote", "Smart note"), ("syncedBlock", "Synced block"),
    ("table", "Table"), ("codeBlock", "Code"), ("somethingNew", "Block"), ("", "Block"),
  ])
  func aPlaceholderIsNamed(type: String, name: String) throws {
    let rows = BlockRows.rows(
      for: try makePage([block("x", type, children: [block("y", "paragraph", text: "hidden")])]),
      in: try makeWorkspace())
    #expect(rows.map(\.kind) == [.placeholder(name: name)])
    #expect(rows.map(\.id) == ["x"])
  }

  @Test(arguments: [(0, 2), (4, 2), (-1, 2), (1, 1), (2, 2), (3, 3)])
  func aHeadingLevelOutsideOneToThreeReadsAsTwo(level: Int, expected: Int) throws {
    let rows = BlockRows.rows(
      for: try makePage([block("h", "heading", ["level": .number(String(level))], text: "H")]),
      in: try makeWorkspace())
    #expect(rows.map(\.kind) == [.text(style: .heading(level: expected))])
  }

  @Test func aHeadingWithoutAnIntegerLevelReadsAsTwo() throws {
    let blocks = [
      block("a", "heading", text: "A"), block("b", "heading", ["level": .string("1")], text: "B"),
      block("c", "heading", ["level": .number("1.5")], text: "C"),
    ]
    let rows = BlockRows.rows(for: try makePage(blocks), in: try makeWorkspace())
    #expect(rows.map(\.kind) == Array(repeating: .text(style: .heading(level: 2)), count: 3))
  }

  @Test func aRepeatedIdGetsADerivedIdInDocumentOrder() throws {
    let blocks = [
      block("a", "paragraph", text: "1"), block("a", "paragraph", text: "2", children: [
        block("a", "paragraph", text: "3")
      ]),
      block("b", "paragraph", text: "4"), block("a", "bulletListItem", text: "5"),
    ]
    let rows = BlockRows.rows(for: try makePage(blocks), in: try makeWorkspace())
    #expect(rows.map(\.id) == ["a", "a#2", "a#3", "b", "a#4"])
    #expect(Set(rows.map(\.id)).count == rows.count)
  }

  @Test func aDerivedIdNeverTakesAnIdTheDocumentHolds() throws {
    let blocks = [block("a", "paragraph"), block("a", "paragraph"), block("a#2", "paragraph")]
    let rows = BlockRows.rows(for: try makePage(blocks), in: try makeWorkspace())
    #expect(rows.count == 3)
    #expect(Set(rows.map(\.id)).count == 3)
    #expect(rows[0].id == "a")
    #expect(rows[2].id == "a#2")
  }

  @Test func aDocumentThatDoesNotParseHasNoRows() throws {
    let page = try #require(
      Page(.object([
        "id": .string("p"), "type": .string("document"), "date": .null, "title": .string("x"),
        "document": .string("{not json"),
      ])))
    #expect(BlockRows.rows(for: page, in: try makeWorkspace()).isEmpty)
  }

  @Test func aTwoThousandBlockDocumentNestedFiftyDeepIsFast() throws {
    func chain(_ prefix: String, depth: Int) -> Block {
      var node = block("\(prefix)-\(depth - 1)", "bulletListItem", text: "x")
      for level in stride(from: depth - 2, through: 0, by: -1) {
        node = block("\(prefix)-\(level)", "bulletListItem", text: "x", children: [node])
      }
      return node
    }
    let blocks = (0..<40).map { chain("c\($0)", depth: 50) }
    let page = try makePage(blocks)
    let workspace = try makeWorkspace()
    let clock = ContinuousClock()
    var rows: [BlockRow] = []
    let elapsed = clock.measure { rows = BlockRows.rows(for: page, in: workspace) }
    print("rows for 2,000 blocks nested 50 deep: \(elapsed)")
    #expect(rows.count == 2000)
    #expect(rows.map(\.depth).max() == 49)
    #expect(Set(rows.map(\.id)).count == 2000)
    #expect(elapsed < .seconds(1))
  }
}
