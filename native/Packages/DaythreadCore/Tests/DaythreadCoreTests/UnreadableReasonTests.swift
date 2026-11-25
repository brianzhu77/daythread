import Testing

@testable import DaythreadCore

/// Which row or field keeps a workspace from reading, said without any title or document text.
@Suite struct UnreadableReasonTests {
  private static let secret = "Private words"

  /// A workspace whose second page (index 1) or second task is `row`; the first is readable.
  private static func workspace(page row: String) throws -> JSONValue {
    try WorkspaceTests.workspace(pages: "[\(WorkspaceTests.page),\(row)]")
  }

  private static func workspace(task row: String) throws -> JSONValue {
    try WorkspaceTests.workspace(tasks: "[\(WorkspaceTests.task),\(row)]")
  }

  @Test func a_readable_workspace_has_no_reason() throws {
    #expect(Workspace.unreadableReason(try WorkspaceTests.workspace()) == nil)
    for original in try Fixtures.workspaces() {
      #expect(Workspace.unreadableReason(original) == nil)
    }
  }

  @Test(arguments: [
    ("revision", #""x""#, "workspace: revision"),
    ("revision", "1.5", "workspace: revision"),
    ("timezone", "3", "workspace: timezone"),
    ("pages", "{}", "workspace: pages"),
    ("tasks", "null", "workspace: tasks"),
  ])
  func the_top_level_names_its_field(key: String, value: String, reason: String) throws {
    var object = try #require(try WorkspaceTests.workspace().objectValue)
    object[key] = try json(value)
    #expect(Workspace.unreadableReason(.object(object)) == reason)
    object[key] = nil
    #expect(Workspace.unreadableReason(.object(object)) == reason, "without \(key)")
  }

  @Test func a_workspace_that_is_not_an_object_says_so() {
    #expect(Workspace.unreadableReason(.array([])) == "workspace: not an object")
  }

  @Test(arguments: [
    (#"{"type":"document","title":"\#(secret)","document":"[]"}"#, "page 1: id"),
    (#"{"id":1,"type":"document","title":"\#(secret)","document":"[]"}"#, "page 1: id"),
    (#"{"id":"day:2026-10-22","title":"\#(secret)","document":"[]"}"#, "page 1 (id day:2026-10-22): type"),
    (#"{"id":"a","type":"document","document":"[]"}"#, "page 1 (id a): title"),
    (#"{"id":"a","type":"document","title":"\#(secret)"}"#, "page 1 (id a): document"),
    (#"{"id":"a","type":"document","title":"\#(secret)","document":[]}"#, "page 1 (id a): document"),
    (
      #"{"id":"day:2026-10-22","type":"day","title":"\#(secret)","document":"[]","date":"2026-02-30"}"#,
      "page 1 (id day:2026-10-22): date"
    ),
    (#"{"id":"a","type":"document","title":"\#(secret)","document":"[]","date":5}"#, "page 1 (id a): date"),
    (#"{"id":"a","type":"document","title":"\#(secret)","document":"[]","parentId":7}"#, "page 1 (id a): parentId"),
    (
      #"{"id":"a","type":"document","title":"\#(secret)","document":"[]","trashedAt":false}"#,
      "page 1 (id a): trashedAt"
    ),
    ("[]", "page 1: not an object"),
    ("null", "page 1: not an object"),
  ])
  func a_page_names_its_index_its_id_and_its_field(row: String, reason: String) throws {
    let found = Workspace.unreadableReason(try Self.workspace(page: row))
    #expect(found == reason)
    #expect(found?.contains(Self.secret) == false)
  }

  @Test(arguments: [
    (#"{"title":"\#(secret)","status":"open","paused":false}"#, "task 1: id"),
    (#"{"id":"t","status":"open","paused":false}"#, "task 1 (id t): title"),
    (#"{"id":"t","title":"\#(secret)","paused":false}"#, "task 1 (id t): status"),
    (#"{"id":"t","title":"\#(secret)","status":"started","paused":false}"#, "task 1 (id t): status"),
    (#"{"id":"t","title":"\#(secret)","status":"open"}"#, "task 1 (id t): paused"),
    (#"{"id":"t","title":"\#(secret)","status":"open","paused":"no"}"#, "task 1 (id t): paused"),
    (#"{"id":"t","title":"\#(secret)","status":"open","paused":false,"deadlineOn":3}"#, "task 1 (id t): deadlineOn"),
    (
      #"{"id":"t","title":"\#(secret)","status":"open","paused":false,"attentionOn":"soon"}"#,
      "task 1 (id t): attentionOn"
    ),
    ("7", "task 1: not an object"),
  ])
  func a_task_names_its_index_its_id_and_its_field(row: String, reason: String) throws {
    let found = Workspace.unreadableReason(try Self.workspace(task: row))
    #expect(found == reason)
    #expect(found?.contains(Self.secret) == false)
  }

  @Test func the_first_unreadable_row_is_named() throws {
    let bad = #"{"id":"x","type":"document","title":"T"}"#
    let pages = "[\(WorkspaceTests.page),\(WorkspaceTests.page),\(bad),\(bad)]"
    #expect(Workspace.unreadableReason(try WorkspaceTests.workspace(pages: pages)) == "page 2 (id x): document")
  }
}
