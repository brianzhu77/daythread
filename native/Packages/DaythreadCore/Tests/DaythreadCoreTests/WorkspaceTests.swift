import Testing

@testable import DaythreadCore

@Suite struct WorkspaceTests {
  static let page = #"{"id":"doc-a","type":"document","date":null,"title":"A","document":"[]"}"#
  static let task = #"{"id":"t1","title":"T","status":"open","paused":false,"deadlineOn":null,"attentionOn":null}"#

  static func workspace(
    revision: String = "3", timezone: String = #""America/Vancouver""#, pages: String = "[\(page)]",
    tasks: String = "[\(task)]"
  ) throws -> JSONValue {
    try json(
      #"{"schemaVersion":2,"revision":\#(revision),"timezone":\#(timezone),"pages":\#(pages),"tasks":\#(tasks),"deletedTasks":[],"receipts":{},"future":{"b":1,"a":2}}"#
    )
  }

  @Test func a_workspace_writes_back_exactly_as_it_was_read() throws {
    let all = try Fixtures.workspaces()
    #expect(all.count >= 6)
    for original in all {
      let workspace = try #require(Workspace(original))
      #expect(workspace.json() == original)
    }
  }

  @Test func fields_this_package_does_not_name_are_kept_and_listed_as_the_rest() throws {
    let original = try Self.workspace()
    let workspace = try #require(Workspace(original))
    #expect(workspace.revision == 3)
    #expect(workspace.timezone == "America/Vancouver")
    #expect(workspace.rest.keys == ["schemaVersion", "deletedTasks", "receipts", "future"])
    #expect(workspace.rest["future"] == (try json(#"{"b":1,"a":2}"#)))
    #expect(workspace.pages.first?.raw["title"] == .string("A"))
  }

  @Test func the_day_page_is_found_by_its_date() throws {
    let all = try Fixtures.workspaces()
    let workspace = try #require(Workspace(all[0]))
    let date = try #require(LocalDate("2026-10-22"))
    let day = try #require(workspace.dayPage(date))
    #expect(day.id == "day:2026-10-22")
    #expect(day.date == date)
    #expect(day.type == "daily")
    #expect(workspace.dayPage(try #require(LocalDate("2026-10-23"))) == nil)
  }

  @Test func pages_and_tasks_are_found_by_id() throws {
    let workspace = try #require(Workspace(try Self.workspace()))
    #expect(workspace.page("doc-a")?.title == "A")
    #expect(workspace.page("nope") == nil)
    #expect(workspace.task("t1")?.status == .open)
    #expect(workspace.task("nope") == nil)
  }

  @Test func ids_are_matched_by_code_units() throws {
    let nfc = "caf\u{E9}"
    let nfd = "cafe\u{301}"
    let pages = #"[{"id":"\#(nfc)","type":"document","title":"A","document":"[]"},{"id":"\#(nfd)","type":"document","title":"B","document":"[]"}]"#
    let workspace = try #require(Workspace(try Self.workspace(pages: pages)))
    #expect(workspace.page(nfc)?.title == "A")
    #expect(workspace.page(nfd)?.title == "B")
  }

  @Test func a_page_reads_its_named_fields_and_keeps_the_object() throws {
    let page = try #require(
      Page(
        try json(
          #"{"id":"day:2026-10-22","type":"daily","date":"2026-10-22","title":"T","parentId":"p","trashedAt":"2026-10-23T00:00:00.000Z","document":"[]","editedAt":"x"}"#
        )))
    #expect(page.date?.value == "2026-10-22")
    #expect(page.parentId == "p")
    #expect(page.trashedAt == "2026-10-23T00:00:00.000Z")
    #expect(page.raw["editedAt"] == .string("x"))
    let bare = try #require(Page(try json(Self.page)))
    #expect(bare.date == nil && bare.parentId == nil && bare.trashedAt == nil)
  }

  @Test(arguments: [
    #"{"type":"document","title":"A","document":"[]"}"#,
    #"{"id":"a","title":"A","document":"[]"}"#,
    #"{"id":"a","type":"document","document":"[]"}"#,
    #"{"id":"a","type":"document","title":"A"}"#,
    #"{"id":1,"type":"document","title":"A","document":"[]"}"#,
    #"{"id":"a","type":"document","title":"A","document":[]}"#,
    #"{"id":"a","type":"document","title":"A","document":"[]","date":5}"#,
    #"{"id":"a","type":"document","title":"A","document":"[]","date":"2026-02-30"}"#,
    #"{"id":"a","type":"document","title":"A","document":"[]","parentId":7}"#,
    #"{"id":"a","type":"document","title":"A","document":"[]","trashedAt":false}"#,
    #"[]"#,
    #"null"#,
  ])
  func a_page_with_a_missing_or_mistyped_field_is_unreadable(_ text: String) throws {
    #expect(Page(try json(text)) == nil)
    #expect(Workspace(try Self.workspace(pages: "[\(Self.page),\(text)]")) == nil)
  }

  @Test(arguments: [
    #"{"title":"T","status":"open","paused":false}"#,
    #"{"id":"t","status":"open","paused":false}"#,
    #"{"id":"t","title":"T","paused":false}"#,
    #"{"id":"t","title":"T","status":"open"}"#,
    #"{"id":"t","title":"T","status":3,"paused":false}"#,
    #"{"id":"t","title":"T","status":"open","paused":"no"}"#,
    #"{"id":"t","title":"T","status":"open","paused":false,"deadlineOn":3}"#,
    #"{"id":"t","title":"T","status":"open","paused":false,"attentionOn":"soon"}"#,
  ])
  func a_task_with_a_missing_or_mistyped_field_is_unreadable(_ text: String) throws {
    #expect(TodoTask(try json(text)) == nil)
    #expect(Workspace(try Self.workspace(tasks: "[\(Self.task),\(text)]")) == nil)
  }

  /// Replaces the earlier expectation that a status other than open, done and cancelled made the workspace
  /// unreadable: a newer server may add one, and the app must still read, show and write back the workspace.
  @Test func a_status_this_build_does_not_know_is_kept_and_the_workspace_still_reads() throws {
    let row = #"{"id":"t","title":"T","status":"waiting","paused":false}"#
    let text = try Self.workspace(tasks: "[\(row)]")
    let workspace = try #require(Workspace(text))
    #expect(workspace.task("t")?.status == .other("waiting"))
    #expect(workspace.task("t")?.status.rawValue == "waiting")
    #expect(JSON.write(workspace.json()) == JSON.write(text))
    #expect(Workspace.unreadableReason(text) == nil)
  }

  @Test func a_task_reads_its_dates_and_status() throws {
    let task = try #require(
      TodoTask(
        try json(
          #"{"id":"t","title":"T","status":"cancelled","paused":true,"deadlineOn":"2026-11-01","attentionOn":"2026-10-30","version":4}"#
        )))
    #expect(task.status == .cancelled)
    #expect(task.paused)
    #expect(task.deadlineOn?.value == "2026-11-01")
    #expect(task.attentionOn?.value == "2026-10-30")
    #expect(task.raw["version"] == .number("4"))
    for status in ["open", "done"] {
      let other = try #require(
        TodoTask(try json(#"{"id":"t","title":"T","status":"\#(status)","paused":false}"#)))
      #expect(other.status.rawValue == status)
    }
  }

  @Test(arguments: [
    ("revision", #""x""#), ("revision", "1.5"), ("timezone", "3"), ("pages", "{}"), ("tasks", "null"),
  ])
  func a_workspace_with_a_mistyped_field_is_unreadable(key: String, value: String) throws {
    var object = try #require(try Self.workspace().objectValue)
    object[key] = try json(value)
    #expect(Workspace(.object(object)) == nil)
  }

  @Test func a_workspace_missing_a_required_field_is_unreadable() throws {
    for key in ["revision", "timezone", "pages", "tasks"] {
      var object = try #require(try Self.workspace().objectValue)
      object[key] = nil
      #expect(Workspace(.object(object)) == nil, "without \(key)")
    }
    #expect(Workspace(.array([])) == nil)
  }

  @Test func a_task_dated_before_the_year_100_still_reads_as_the_server_stored_it() throws {
    let task = #"{"id":"t2","title":"T","status":"open","paused":false,"deadlineOn":"0026-10-22","attentionOn":"0000-01-01"}"#
    let original = try Self.workspace(tasks: "[\(Self.task),\(task)]")
    let workspace = try #require(Workspace(original))
    #expect(workspace.task("t2")?.deadlineOn?.value == "0026-10-22")
    #expect(workspace.task("t2")?.attentionOn?.value == "0000-01-01")
    #expect(workspace.json() == original)
  }

  @Test func audit_finds_no_page_that_fails_to_round_trip_in_the_shared_cases() throws {
    for original in try Fixtures.workspaces() {
      let workspace = try #require(Workspace(original))
      #expect(Audit.pagesThatDoNotRoundTrip(workspace).isEmpty)
    }
  }

  @Test func audit_names_the_pages_whose_document_does_not_read_or_write_back_the_same() throws {
    let pages = [
      #"{"id":"ok","type":"document","title":"","document":"[]"}"#,
      #"{"id":"broken","type":"document","title":"","document":"{not json"}"#,
      #"{"id":"spaced","type":"document","title":"","document":"[ ]"}"#,
      #"{"id":"fine","type":"document","title":"","document":"[{\"id\":\"a\",\"type\":\"paragraph\",\"props\":{},\"content\":[],\"children\":[]}]"}"#,
      #"{"id":"object","type":"document","title":"","document":"{}"}"#,
    ].joined(separator: ",")
    let workspace = try #require(Workspace(try Self.workspace(pages: "[\(pages)]")))
    #expect(Audit.pagesThatDoNotRoundTrip(workspace) == ["broken", "spaced", "object"])
  }

  /// A day's draft is a hidden page (`type: "draft"`) whose document is the draft's own object, not blocks.
  @Test func audit_holds_a_day_draft_to_writing_back_the_same_not_to_being_blocks() throws {
    let pages = [
      #"{"id":"day:2026-11-25","type":"daily","date":"2026-11-25","title":"","document":"[]"}"#,
      #"{"id":"draft:day:2026-11-25","type":"draft","date":null,"title":"","parentId":"day:2026-11-25","document":"{\"status\":\"ready\",\"items\":[{\"id\":\"i1\",\"anchor\":\"a\",\"place\":\"fill\",\"taskId\":\"t1\",\"source\":\"model\",\"state\":\"applied\"}],\"moreOpen\":[],\"recipe\":5}"}"#,
      #"{"id":"draft:spaced","type":"draft","title":"","document":"{ \"status\":\"ready\"}"}"#,
      #"{"id":"draft:broken","type":"draft","title":"","document":"{not json"}"#,
    ].joined(separator: ",")
    let workspace = try #require(Workspace(try Self.workspace(pages: "[\(pages)]")))
    #expect(Audit.pagesThatDoNotRoundTrip(workspace) == ["draft:spaced", "draft:broken"])
  }
}
