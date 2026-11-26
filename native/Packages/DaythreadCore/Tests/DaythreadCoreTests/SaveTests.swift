import Foundation
import Testing

@testable import DaythreadCore

@Suite struct SaveTests {
  private func day(_ text: String) throws -> LocalDate { try #require(LocalDate(text)) }

  @Test func the_save_command_is_written_as_the_web_writes_it() throws {
    let at = Date(timeIntervalSince1970: 1_792_661_400.123)
    let command = Command.saveEditor(
      pageId: "day:2026-10-22", expectedContent: "d:2:6cec00d0556f7072473e37b06d814675", document: "[]",
      singleDeleteIds: ["r2"], today: try day("2026-10-22"), at: at)
    #expect(
      JSON.write(command)
        == #"{"type":"save-editor","pageId":"day:2026-10-22","expectedContent":"d:2:6cec00d0556f7072473e37b06d814675","document":"[]","singleDeleteIds":["r2"],"today":"2026-10-22","at":"2026-10-22T09:30:00.123Z"}"#
    )

    let none = Command.saveEditor(
      pageId: "p", expectedContent: "k", document: "[]", singleDeleteIds: [], today: try day("2026-10-22"),
      at: Date(timeIntervalSince1970: 1_792_661_400))
    #expect(
      JSON.write(none)
        == #"{"type":"save-editor","pageId":"p","expectedContent":"k","document":"[]","today":"2026-10-22","at":"2026-10-22T09:30:00.000Z"}"#
    )
  }

  private func command(from entry: SaveCase) throws -> JSONValue {
    let ids = (entry.action["singleDeleteIds"]?.arrayValue ?? []).compactMap(\.stringValue)
    let at = try #require(entry.action["at"]?.stringValue)
    return Command.saveEditor(
      pageId: entry.pageId, expectedContent: try #require(entry.action["expectedContent"]?.stringValue),
      document: entry.document, singleDeleteIds: ids,
      today: try day(try #require(entry.action["today"]?.stringValue)), at: try #require(Self.parse(at)))
  }

  /// The fixture script writes `singleDeleteIds` after `at` in this one case; every other case is in the web's order.
  private static let singleDeleteIdsAfterAt = "row-removed-kept-elsewhere"

  @Test func the_command_is_written_exactly_as_every_shared_cases_action() throws {
    for name in try Fixtures.saveNames() where name != Self.singleDeleteIdsAfterAt {
      let entry = try Fixtures.saveCase(name)
      #expect(JSON.write(try command(from: entry)) == JSON.write(.object(entry.action)), "\(name)")
    }
  }

  @Test func the_command_has_the_fields_of_the_case_that_puts_single_delete_ids_last() throws {
    let entry = try Fixtures.saveCase(Self.singleDeleteIdsAfterAt)
    #expect(equalIgnoringTopLevelKeyOrder(try command(from: entry), .object(entry.action)))
  }

  private static func parse(_ text: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: text)
  }

  @Test func the_key_of_each_cases_page_is_what_the_save_expects() throws {
    for name in try Fixtures.saveNames() where name != "page-changed-elsewhere" && name != "saved-elsewhere" {
      let entry = try Fixtures.saveCase(name)
      let page = try #require(entry.beforePage)
      #expect(ContentKey.of(page.document) == entry.action["expectedContent"]?.stringValue, "\(name)")
    }
  }

  // MARK: Typing what the cases sent

  private func blocks(_ document: String) throws -> [JSONValue] {
    try #require(try JSON.parse(document).arrayValue)
  }

  private func fields(_ block: JSONValue?, _ names: [String]) -> [JSONValue?] {
    names.map { block?.objectValue?[$0] }
  }

  @Test func a_page_typed_into_by_the_app_is_what_the_shared_case_sent() throws {
    // untouched-synced-and-database: one paragraph's words change; the rest is written back as it was.
    do {
      let entry = try Fixtures.saveCase("untouched-synced-and-database")
      var page = EditablePage(document: try #require(entry.beforePage).document, pageDate: nil)
      _ = page.replaceText(in: "p1", range: 5..<5, with: ", world")
      #expect(page.document == entry.document)
    }
    // typed-words: a new paragraph at the end. The fixture script writes `props: {}` where the app writes the
    // editor's default props, so everything else is compared.
    do {
      let entry = try Fixtures.saveCase("typed-words")
      let before = try #require(entry.beforePage)
      var page = EditablePage(document: before.document, pageDate: before.date, makeID: { "typed" })
      let caret = page.press(.returnKey, at: .init(block: "r2", offset: 16))
      let paragraph = try #require(caret.flatMap { page.press(.returnKey, at: $0) })
      _ = page.replaceText(in: paragraph.block, range: 0..<0, with: "Went for a run")
      let sent = try blocks(entry.document)
      let typed = try blocks(page.document)
      #expect(typed.count == sent.count)
      #expect(Array(typed.dropLast()) == Array(sent.dropLast()))
      let names = ["id", "type", "content", "children"]
      #expect(fields(typed.last, names) == fields(sent.last, names))
    }
    // new-to-do: a to-do row after the last one.
    do {
      let entry = try Fixtures.saveCase("new-to-do")
      let before = try #require(entry.beforePage)
      var page = EditablePage(document: before.document, pageDate: before.date, makeID: { "n1" })
      let caret = page.press(.returnKey, at: .init(block: "r2", offset: 16))
      _ = page.replaceText(in: try #require(caret).block, range: 0..<0, with: "Water the plants")
      #expect(try blocks(page.document) == blocks(entry.document))
    }
  }

  // MARK: Drawing a draft

  private static let dayPage = "day:2026-10-22"

  private func row(_ id: String, taskId: JSONValue, words: String) -> String {
    let content = words.isEmpty ? "[]" : #"[{"type":"text","text":"\#(words)","styles":{}}]"#
    return
      #"{"id":"\#(id)","type":"task","props":{"taskId":\#(JSON.write(taskId)),"role":"plan","planDate":"2026-10-22"},"content":\#(content),"children":[]}"#
  }

  private func draft(_ rows: String...) -> String { "[" + rows.joined(separator: ",") + "]" }

  @Test func a_draft_is_drawn_with_its_new_to_dos_open() throws {
    let workspace = try Fixtures.saveCase("new-to-do").before
    let document = draft(
      row("r1", taskId: .string("editor-task:r1"), words: "Write the report, again"),
      row("n1", taskId: .string("editor-task:n1"), words: "Water the plants"),
      row("n2", taskId: .string("editor-task:n2"), words: ""),
      row("n3", taskId: .string("editor-task:n3"), words: "   "),
      row("n4", taskId: .number("4"), words: "Not a string id"))

    let drawn = workspace.drawing(draft: document, of: Self.dayPage)

    #expect(drawn.page(Self.dayPage)?.document == document)
    let made = try #require(drawn.task("editor-task:n1"))
    #expect(made.title == "Water the plants")
    #expect(made.status == .open)
    #expect(made.version == 1)
    #expect(made.paused == false)
    #expect(drawn.task("editor-task:n2") == nil)
    #expect(drawn.task("editor-task:n3") == nil)
    #expect(drawn.tasks.count == workspace.tasks.count + 1)
    // A to-do the workspace already holds is untouched, whatever the row says now.
    #expect(drawn.task("editor-task:r1") == workspace.task("editor-task:r1"))
    // Another page is untouched.
    #expect(drawn.page("doc-a") == workspace.page("doc-a"))
    #expect(drawn.pages.count == workspace.pages.count)
    // What is drawn is the workspace's own JSON, so it reads back the same.
    #expect(Workspace(drawn.json()) == drawn)
  }

  @Test func a_to_do_is_cut_as_the_server_cuts_it_and_made_once() throws {
    let workspace = try Fixtures.saveCase("new-to-do").before
    let long = String(repeating: "a", count: 1200)
    let drawn = workspace.drawing(
      draft: draft(
        row("n1", taskId: .string("editor-task:n1"), words: long),
        row("n1b", taskId: .string("editor-task:n1"), words: "Twice")),
      of: Self.dayPage)
    #expect(drawn.task("editor-task:n1")?.title == String(repeating: "a", count: 1000))
    #expect(drawn.tasks.filter { $0.id == "editor-task:n1" }.count == 1)
  }

  @Test func a_page_that_is_not_there_or_a_draft_that_does_not_parse_changes_nothing() throws {
    let workspace = try Fixtures.saveCase("new-to-do").before
    #expect(workspace.drawing(draft: "[]", of: "nowhere") == workspace)
    #expect(workspace.drawing(draft: "not json", of: Self.dayPage) == workspace)
    #expect(workspace.drawing(draft: #"{"a":1}"#, of: Self.dayPage) == workspace)
  }

  @Test func what_the_app_draws_for_a_new_to_do_is_what_the_server_then_makes() throws {
    let entry = try Fixtures.saveCase("new-to-do")
    let drawn = entry.before.drawing(draft: entry.document, of: entry.pageId)
    let after = try #require(entry.after)
    let predicted = try #require(drawn.task("editor-task:n1"))
    let made = try #require(after.task("editor-task:n1"))
    #expect(predicted.id == made.id)
    #expect(predicted.status == made.status)
    #expect(predicted.title == made.title)
    #expect(predicted.version == made.version)
  }

  private func character(_ value: UInt32) -> String { String(Character(UnicodeScalar(value)!)) }

  @Test func a_row_is_blank_by_javascripts_rule_not_foundations() throws {
    let workspace = try Fixtures.saveCase("new-to-do").before
    // U+FEFF is whitespace to `trim()`; U+0085 is not.
    let drawn = workspace.drawing(
      draft: draft(
        row("n1", taskId: .string("editor-task:n1"), words: character(0xFEFF)),
        row("n2", taskId: .string("editor-task:n2"), words: character(0x85))),
      of: Self.dayPage)
    #expect(drawn.task("editor-task:n1") == nil)
    #expect(drawn.task("editor-task:n2") != nil)
  }

  @Test func a_row_of_a_deleted_to_do_gets_no_drawn_to_do() throws {
    let entry = try Fixtures.saveCase("row-removed")
    let after = try #require(entry.after)
    let buried = try #require(
      after.json().objectValue?["deletedTasks"]?.arrayValue?.first?.objectValue?["id"]?.stringValue)
    #expect(after.task(buried) == nil)
    let drawn = after.drawing(draft: draft(row("again", taskId: .string(buried), words: "Back")), of: entry.pageId)
    #expect(drawn.task(buried) == nil)
    #expect(drawn.tasks == after.tasks)
  }

  @Test func a_row_with_no_words_in_the_shared_case_is_not_drawn() throws {
    let entry = try Fixtures.saveCase("new-to-do-without-words")
    let drawn = entry.before.drawing(draft: entry.document, of: entry.pageId)
    #expect(drawn.tasks == entry.before.tasks)
  }
}
