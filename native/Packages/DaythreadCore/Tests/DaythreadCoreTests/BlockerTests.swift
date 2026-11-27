import Testing

@testable import DaythreadCore

@Suite struct BlockerTests {
  @Test func blockers_in_force_are_the_webs() throws {
    let cases = try Fixtures.cases("blockers/cases.json")
    #expect(cases.count == 9)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let workspace = try #require(entry["workspace"].flatMap(Workspace.init), "workspace: \(name)")
      let blocked = try #require(entry["blocked"]?.objectValue, "blocked: \(name)")
      let words = try #require(entry["words"]?.objectValue, "words: \(name)")
      let index = TodoIndex(workspace)
      for task in workspace.tasks {
        let expected = blocked[task.id]?.arrayValue?.compactMap(\.stringValue) ?? []
        let found = index.blockers(of: task.id)
        #expect(found.map(\.id) == expected, "blockers of \(task.id): \(name)")
        #expect(Blockers.words(found) == words[task.id]?.stringValue, "words of \(task.id): \(name)")
      }
    }
  }

  @Test func words_name_one_blocker_and_count_more() throws {
    let a = try #require(TodoTask(TestWorkspace.task("a", title: "Buy paint")))
    let b = try #require(TodoTask(TestWorkspace.task("b", title: "Book the room")))
    #expect(Blockers.words([]) == nil)
    #expect(Blockers.words([a]) == "Blocked by Buy paint")
    #expect(Blockers.words([a, b]) == "Blocked by 2")
  }

  @Test func links_that_do_not_read_are_skipped_and_the_rest_keep_their_order() throws {
    let rows = [TestWorkspace.row("a"), TestWorkspace.row("b"), TestWorkspace.row("c")]
    let workspace = try TestWorkspace.make(
      pages: [TestWorkspace.day("2026-11-26", rows: rows)],
      tasks: [TestWorkspace.task("a"), TestWorkspace.task("b"), TestWorkspace.task("c")],
      rest: [
        (
          "links",
          .array([
            TestWorkspace.link(blocked: "a", blocker: "c"),
            .string("junk"),
            .object(["blockedId": .string("a")]),
            .object(["blockedId": .number("1"), "blockerId": .string("b")]),
            TestWorkspace.link(blocked: "a", blocker: "b"),
          ])
        )
      ])
    #expect(TodoIndex(workspace).blockers(of: "a").map(\.id) == ["c", "b"])
    let notAnArray = try TestWorkspace.make(tasks: [TestWorkspace.task("a")], rest: [("links", .string("nope"))])
    #expect(TodoIndex(notAnArray).blockers(of: "a").isEmpty)
  }

  @Test func a_link_to_a_to_do_without_a_live_row_is_not_in_force() throws {
    // Only `b` has a row: the link from `b` to `a`, which has none, holds nothing up.
    let workspace = try TestWorkspace.make(
      pages: [TestWorkspace.day("2026-11-26", rows: [TestWorkspace.row("b")])],
      tasks: [TestWorkspace.task("a"), TestWorkspace.task("b")],
      rest: [("links", .array([TestWorkspace.link(blocked: "b", blocker: "a")]))])
    #expect(TodoIndex(workspace).blockers(of: "b").isEmpty)
  }
}
