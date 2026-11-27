import Testing

@testable import DaythreadCore

@Suite struct RowNoticeTests {
  static func day(_ text: String) throws -> LocalDate { try #require(LocalDate(text)) }

  @Test func notices_are_the_webs() throws {
    let cases = try Fixtures.cases("notices/cases.json")
    #expect(cases.count == 14)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let action = try #require(RowAction(intent: entry["intent"]?.objectValue), "intent: \(name)")
      let task = try #require(entry["task"].flatMap(TodoTask.init), "task: \(name)")
      let receipt = try #require(entry["receipt"].flatMap(Receipt.init), "receipt: \(name)")
      let text = RowNotice.text(
        after: action, task: task, pageDate: try Self.day(try #require(entry["day"]?.stringValue)),
        today: try Self.day(try #require(entry["today"]?.stringValue)), receipt: receipt,
        plannedAfter: try entry["plannedAfter"]?.stringValue.map(Self.day))
      #expect(text == entry["text"]?.stringValue, "text: \(name)")
    }
  }

  @Test func the_fixed_words() throws {
    let fixed = try #require(try Fixtures.json("notices/fixed.json").objectValue)
    #expect(RowNotice.undone == fixed["undone"]?.stringValue)
    #expect(RowNotice.cantUndo == fixed["cantUndo"]?.stringValue)
    #expect(RowNotice.couldntUndo == fixed["couldntUndo"]?.stringValue)
    #expect(RowNotice.notDone == fixed["notDone"]?.stringValue)
    // The straight apostrophe and the middle dot, as the web writes them.
    #expect(RowNotice.cantUndo.unicodeScalars.map(\.value).contains(0x27))
    #expect(RowNotice.cantUndo.unicodeScalars.map(\.value).contains(0xB7))
    #expect(fixed["plannedForToday"]?.stringValue == "Planned for today")
  }

  @Test func the_reference_rows_button_has_its_own_notice() throws {
    let task = try #require(TodoTask(TestWorkspace.task("t")))
    let receipt = try #require(Receipt(try json(#"{"message":"Task moved"}"#)))
    let today = try Self.day("2026-11-26")
    #expect(
      RowNotice.text(
        after: .planForTodayButton, task: task, pageDate: today, today: today, receipt: receipt, plannedAfter: today)
        == "Planned for today")
    #expect(
      RowNotice.text(
        after: .bringToToday, task: task, pageDate: today, today: today, receipt: receipt, plannedAfter: today)
        == "On today")
  }

  @Test func a_stale_row_names_the_day_it_is_still_planned_for_or_its_own_when_none() throws {
    let task = try #require(TodoTask(TestWorkspace.task("t")))
    let receipt = try #require(Receipt(try json(#"{"message":"Removed from the day"}"#)))
    let today = try Self.day("2026-11-26")
    #expect(
      RowNotice.text(
        after: .notToday, task: task, pageDate: today, today: today, receipt: receipt, plannedAfter: nil)
        == "Removed from Thu · still planned for Thu")
  }

  @Test func a_receipt_reads_its_message_and_the_days_of_the_next_to_dos() throws {
    let receipt = try #require(
      Receipt(
        try json(
          #"{"operationId":"c","message":"Cancelled","nextTodos":[{"taskId":"n","on":"2026-12-07"}],"revision":4}"#)))
    #expect(receipt.message == "Cancelled")
    #expect(receipt.nextTodos.map(\.value) == ["2026-12-07"])
    #expect(try #require(Receipt(try json(#"{"message":"Task moved"}"#))).nextTodos.isEmpty)
    #expect(Receipt(try json(#"{"operationId":"c"}"#)) == nil)
    #expect(Receipt(try json(#"{"message":3}"#)) == nil)
    #expect(Receipt(.null) == nil)
  }

  @Test func an_unreadable_next_to_dos_list_never_costs_a_notice() throws {
    let task = try #require(TodoTask(TestWorkspace.task("t")))
    let today = try Self.day("2026-11-26")
    let friday = try Self.day("2026-11-27")
    func notice(_ action: RowAction, _ receipt: String) throws -> String {
      let receipt = try #require(Receipt(try json(receipt)))
      return RowNotice.text(
        after: action, task: task, pageDate: today, today: today, receipt: receipt, plannedAfter: today)
    }
    let unreadable = [
      #"{"message":"Task moved","nextTodos":"soon"}"#,
      #"{"message":"Task moved","nextTodos":[{"taskId":"n"}]}"#,
      #"{"message":"Task moved","nextTodos":[{"taskId":"n","on":"nope"}]}"#,
      #"{"message":"Task moved","nextTodos":[3]}"#,
    ]
    for receipt in unreadable {
      #expect(try notice(.move(friday), receipt) == "Moved to Fri, Nov 27", "\(receipt)")
      #expect(try notice(.restore, receipt) == "Restored", "\(receipt)")
      #expect(try notice(.cancel, receipt) == "Cancelled", "\(receipt)")
    }
    // An unreadable entry is never the one, and never makes two read as one.
    let one = #"{"on":"2026-12-07"}"#
    #expect(try notice(.cancel, #"{"message":"c","nextTodos":[\#(one),{"taskId":"n"}]}"#) == "Cancelled")
    #expect(try notice(.cancel, #"{"message":"c","nextTodos":[{"taskId":"n"},\#(one)]}"#) == "Cancelled")
    #expect(try notice(.cancel, #"{"message":"c","nextTodos":[\#(one)]}"#) == "Cancelled · Next Mon, Dec 7")
  }
}
