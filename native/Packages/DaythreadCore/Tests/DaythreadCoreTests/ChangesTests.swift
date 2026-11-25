import Testing

@testable import DaythreadCore

@Suite struct ChangesTests {
  struct Case {
    var name: String
    var before: JSONValue
    var changes: JSONValue
    var after: JSONValue
  }

  static func cases() throws -> [Case] {
    try Fixtures.changeNames().map { name in
      let file = try #require(try Fixtures.json("changes/\(name).json").objectValue)
      return Case(
        name: name, before: try #require(file["before"]), changes: try #require(file["changes"]),
        after: try #require(file["after"]))
    }
  }

  static func fixture(_ name: String) throws -> Case {
    try #require(try cases().first { $0.name == name })
  }

  static func apply(_ before: JSONValue, _ changes: JSONValue) throws -> JSONValue? {
    let workspace = try #require(Workspace(before))
    let parsed = try #require(WorkspaceChanges(changes))
    return workspace.applying(parsed)?.json()
  }

  /// The fixture's workspace with `changes` replaced by `patch` merged over it.
  static func patched(_ name: String, _ patch: String) throws -> (before: JSONValue, changes: JSONValue) {
    let file = try fixture(name)
    var changes = try #require(file.changes.objectValue)
    let patch = try #require(try json(patch).objectValue)
    for key in patch.keys { changes[key] = patch[key] }
    return (file.before, .object(changes))
  }

  @Test func every_shared_case_gives_the_workspace_the_domain_gives() throws {
    let all = try Self.cases()
    #expect(all.count >= 5)
    for c in all {
      let result = try Self.apply(c.before, c.changes)
      if c.after == .null {
        #expect(result == nil, "\(c.name) must not apply")
      } else {
        #expect(equalIgnoringTopLevelKeyOrder(result, c.after), "\(c.name)")
        // Below the top level the result matches in order too.
        #expect(result?.objectValue?["pages"] == c.after.objectValue?["pages"], "\(c.name) pages")
        #expect(result?.objectValue?["tasks"] == c.after.objectValue?["tasks"], "\(c.name) tasks")
      }
    }
  }

  @Test func changes_made_from_another_revision_do_not_apply() throws {
    let file = try Self.fixture("task-ticked")
    var workspace = try #require(Workspace(file.before))
    let changes = try #require(WorkspaceChanges(file.changes))
    workspace.revision += 1
    #expect(workspace.applying(changes) == nil)
  }

  @Test func changes_say_what_they_touch() throws {
    let removed = try #require(WorkspaceChanges(try Self.fixture("page-removed").changes))
    #expect(removed.from == 5 && removed.revision == 6)
    #expect(removed.removedPageIds == ["tpl-1"])
    #expect(removed.upsertedPageIds.isEmpty && !removed.pagesReordered)
    #expect(removed.upsertedTaskIds.isEmpty && removed.removedTaskIds.isEmpty && !removed.tasksReordered)

    let moved = try #require(WorkspaceChanges(try Self.fixture("pages-reordered").changes))
    #expect(moved.pagesReordered && !moved.tasksReordered)

    let added = try #require(WorkspaceChanges(try Self.fixture("task-added").changes))
    #expect(added.upsertedPageIds == ["day:2026-10-22"])
    #expect(added.upsertedTaskIds.count == 1)
  }

  @Test(arguments: ["from", "revision", "timezone", "pages", "tasks"])
  func changes_without_a_required_field_are_unreadable(_ key: String) throws {
    var changes = try #require(Self.fixture("task-ticked").changes.objectValue)
    changes[key] = nil
    #expect(WorkspaceChanges(.object(changes)) == nil)
  }

  @Test(arguments: [
    ("from", #""5""#), ("revision", "6.5"), ("timezone", "1"), ("pages", "[]"), ("tasks", "null"),
    ("pages", #"{"upsert":{},"remove":[]}"#), ("pages", #"{"upsert":[],"remove":[3]}"#),
    ("pages", #"{"upsert":[{"id":"x"}],"remove":[]}"#), ("tasks", #"{"upsert":[],"remove":[],"order":"a"}"#),
    ("undo", "5"), ("synced", "{}"), ("todoAutomations", "3"), ("deletedTasks", #""x""#),
  ])
  func changes_with_a_malformed_field_are_unreadable(key: String, value: String) throws {
    var changes = try #require(Self.fixture("task-ticked").changes.objectValue)
    changes[key] = try json(value)
    #expect(WorkspaceChanges(.object(changes)) == nil)
  }

  @Test func changes_that_name_an_order_the_result_does_not_have_do_not_apply() throws {
    let (before, changes) = try Self.patched(
      "pages-reordered", #"{"pages":{"upsert":[],"remove":[],"order":["doc-b","doc-a","tpl-1"]}}"#)
    #expect(try Self.apply(before, changes) == nil)
    let (b2, c2) = try Self.patched(
      "pages-reordered",
      #"{"pages":{"upsert":[],"remove":[],"order":["doc-b","doc-a","tpl-1","day:2026-10-22","extra"]}}"#)
    #expect(try Self.apply(b2, c2) == nil)
    let (b3, c3) = try Self.patched(
      "pages-reordered",
      #"{"tasks":{"upsert":[],"remove":[],"order":["nope"]}}"#)
    #expect(try Self.apply(b3, c3) == nil)
  }

  @Test func an_upserted_page_that_is_new_goes_at_the_end_and_an_old_one_stays_where_it_was() throws {
    let (before, changes) = try Self.patched(
      "page-removed",
      #"{"pages":{"upsert":[{"id":"doc-a","type":"document","date":null,"title":"Renamed","document":"[]"},{"id":"new","type":"document","date":null,"title":"New","document":"[]"}],"remove":["tpl-1"]}}"#
    )
    let result = try #require(try Self.apply(before, changes)?.objectValue)
    let pages = try #require(result["pages"]?.arrayValue)
    let ids = pages.compactMap { $0.objectValue?["id"]?.stringValue }
    #expect(ids == ["doc-a", "doc-b", "day:2026-10-22", "new"])
    #expect(pages.first?.objectValue?["title"] == .string("Renamed"))
  }

  @Test func the_timezone_and_revision_are_the_changes() throws {
    let (before, changes) = try Self.patched("task-ticked", #"{"timezone":"Asia/Tokyo"}"#)
    let result = try #require(try Self.apply(before, changes)?.objectValue)
    #expect(result["timezone"] == .string("Asia/Tokyo"))
    #expect(result["revision"] == .number("6"))
    #expect(result["receipts"] == (try json("{}")))
  }

  @Test func week_start_unreadable_rules_and_undo_are_set_or_removed_as_the_changes_have_them() throws {
    var (before, changes) = try Self.patched(
      "task-ticked",
      #"{"weekStart":1,"todoAutomationsUnreadable":true,"undo":{"operationId":"o","revision":6}}"#)
    var result = try #require(try Self.apply(before, changes)?.objectValue)
    #expect(result["weekStart"] == .number("1"))
    #expect(result["todoAutomationsUnreadable"] == .bool(true))
    #expect(result["undo"] == (try json(#"{"operationId":"o","revision":6}"#)))

    // The workspace had them; changes without them take them away.
    var object = try #require(before.objectValue)
    object["weekStart"] = .number("1")
    object["todoAutomationsUnreadable"] = .bool(true)
    object["undo"] = try json(#"{"operationId":"old","revision":5}"#)
    before = .object(object)
    var plain = try #require(changes.objectValue)
    for key in ["weekStart", "todoAutomationsUnreadable", "undo"] { plain[key] = nil }
    result = try #require(try Self.apply(before, .object(plain))?.objectValue)
    #expect(result["weekStart"] == nil)
    #expect(result["todoAutomationsUnreadable"] == nil)
    #expect(result["undo"] == nil)
    changes = .object(plain)

    // `undo: null` and a week start other than Monday leave nothing behind.
    plain["undo"] = .null
    plain["weekStart"] = .number("2")
    result = try #require(try Self.apply(before, .object(plain))?.objectValue)
    #expect(result["undo"] == nil && result["weekStart"] == nil)
  }

  @Test func a_list_the_changes_carry_replaces_the_workspaces_whole_and_an_empty_one_removes_it() throws {
    let note = #"{"id":"n1","text":"hello"}"#
    let (before, changes) = try Self.patched(
      "task-ticked",
      #"{"deletedTasks":[],"synced":[],"smartNotes":[\#(note)],"threads":[\#(note)],"links":[\#(note)],"todoRepeats":[\#(note)],"todoAutomations":[\#(note)]}"#
    )
    let result = try #require(try Self.apply(before, changes)?.objectValue)
    for key in ["smartNotes", "threads", "links", "todoRepeats", "todoAutomations"] {
      #expect(result[key] == (try json("[\(note)]")), "\(key)")
    }
    #expect(result["deletedTasks"] == (try json("[]")))
    #expect(result["synced"] == (try json("[]")), "an empty synced list is kept")

    // Now the workspace holds them and the changes carry them empty.
    var held = try #require(before.objectValue)
    for key in ["smartNotes", "threads", "links", "todoRepeats", "todoAutomations", "synced"] {
      held[key] = try json("[\(note)]")
    }
    var emptied = try #require(changes.objectValue)
    for key in ["smartNotes", "threads", "links", "todoRepeats", "todoAutomations"] { emptied[key] = try json("[]") }
    let cleared = try #require(try Self.apply(.object(held), .object(emptied))?.objectValue)
    for key in ["smartNotes", "threads", "links", "todoRepeats", "todoAutomations"] {
      #expect(cleared[key] == nil, "\(key) is dropped when empty")
    }

    // Absent from the changes: the workspace's own lists stay. `todoAutomations: null` takes the rules away.
    var absent = try #require(changes.objectValue)
    for key in ["deletedTasks", "synced", "smartNotes", "threads", "links", "todoRepeats", "todoAutomations"] {
      absent[key] = nil
    }
    let kept = try #require(try Self.apply(.object(held), .object(absent))?.objectValue)
    for key in ["synced", "smartNotes", "threads", "links", "todoRepeats", "todoAutomations"] {
      #expect(kept[key] == (try json("[\(note)]")), "\(key) stays")
    }
    absent["todoAutomations"] = .null
    let withoutRules = try #require(try Self.apply(.object(held), .object(absent))?.objectValue)
    #expect(withoutRules["todoAutomations"] == nil)
    #expect(withoutRules["smartNotes"] == (try json("[\(note)]")))
  }
}
