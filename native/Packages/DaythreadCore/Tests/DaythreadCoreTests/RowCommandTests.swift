import Testing

@testable import DaythreadCore

@Suite struct RowCommandTests {
  static func day(_ text: String) throws -> LocalDate { try #require(LocalDate(text)) }

  /// The cases the server takes; the others are refusals.
  private func takenCases() throws -> [ActionCase] {
    try Fixtures.actionNames().map(Fixtures.actionCase).filter { $0.refused == nil }
  }

  @Test func each_command_is_written_as_the_web_writes_it() throws {
    let taken = try takenCases()
    #expect(taken.count == 10)
    for entry in taken {
      let today = try Self.day(entry.today)
      let taskId = try #require(entry.taskId, "taskId: \(entry.name)")
      let written: JSONValue
      if Command.type(of: entry.action) == "undo" {
        written = Command.undo(targetOperationId: try #require(entry.action.objectValue?["targetOperationId"]?.stringValue))
      } else {
        let action = try #require(RowAction(intent: entry.intent), "intent: \(entry.name)")
        written = try #require(
          Command.forRow(action, taskId: taskId, pageDate: try Self.day(try #require(entry.day)), today: today),
          "command: \(entry.name)")
      }
      #expect(JSON.write(written) == JSON.write(entry.action), "command: \(entry.name)")
    }
  }

  @Test func the_reference_rows_button_sends_what_bring_to_today_does() throws {
    let today = try Self.day("2026-11-26")
    #expect(
      Command.forRow(.planForTodayButton, taskId: "t", pageDate: today, today: today)
        == Command.forRow(.bringToToday, taskId: "t", pageDate: today, today: today))
    #expect(
      JSON.write(try #require(Command.forRow(.bringToToday, taskId: "t", pageDate: try Self.day("2026-11-20"), today: today)))
        == #"{"type":"plan-task","taskId":"t","date":"2026-11-26","today":"2026-11-26"}"#)
  }

  @Test func a_refused_undo_is_the_same_command() throws {
    for name in ["undo-after-a-later-change", "undo-after-ensure-day"] {
      let entry = try Fixtures.actionCase(name)
      #expect(entry.refused != nil)
      #expect(
        JSON.write(Command.undo(targetOperationId: "cmd-move")) == JSON.write(entry.action), "command: \(name)")
      #expect(entry.notice == RowNotice.cantUndo, "notice: \(name)")
    }
  }

  @Test func the_notice_after_each_shared_action_is_the_webs() throws {
    var checked = 0
    for entry in try takenCases() {
      guard entry.intent != nil else { continue }
      let name = entry.name
      let action = try #require(
        RowAction(intent: entry.intent, button: name == "plan-for-today-from-a-reference-row"), "intent: \(name)")
      let taskId = try #require(entry.taskId)
      let task = try #require(entry.before.task(taskId), "task: \(name)")
      let receipt = try #require(entry.receipt.flatMap(Receipt.init), "receipt: \(name)")
      let after = try #require(entry.after, "after: \(name)")
      // The notice reads `plannedOn` of the workspace after the answer; the case states it.
      #expect(TodoIndex(after).plannedOn(taskId)?.value == entry.plannedAfter, "plannedOn: \(name)")
      let text = RowNotice.text(
        after: action, task: task, pageDate: try Self.day(try #require(entry.day)), today: try Self.day(entry.today),
        receipt: receipt, plannedAfter: TodoIndex(after).plannedOn(taskId))
      #expect(text == entry.notice, "notice: \(name)")
      checked += 1
    }
    #expect(checked == 9)
    #expect(try Fixtures.actionCase("undo").notice == RowNotice.undone)
  }

  @Test func the_undo_marker_is_the_commands() throws {
    for entry in try takenCases() {
      let marker = try #require(entry.after).undoMarker
      if entry.intent == nil {
        #expect(marker == nil, "no marker after an undo: \(entry.name)")
      } else {
        #expect(
          marker == UndoMarker(operationId: "cmd-\(entry.name)", revision: try #require(entry.after).revision),
          "marker: \(entry.name)")
      }
    }
    let base = try #require(try Fixtures.actionCase("restore").before.json().objectValue)
    func marker(_ undo: JSONValue?) throws -> UndoMarker? {
      var object = base
      object["undo"] = undo
      return try #require(Workspace(.object(object))).undoMarker
    }
    #expect(try marker(nil) == nil)
    #expect(try marker(.null) == nil)
    #expect(try marker(try json(#"{"operationId":3,"revision":4}"#)) == nil)
    #expect(try marker(try json(#"{"operationId":"cmd-x"}"#)) == nil)
    #expect(try marker(try json(#"{"operationId":"cmd-x","revision":"4"}"#)) == nil)
    #expect(try marker(try json(#"{"operationId":"cmd-x","revision":4}"#)) == UndoMarker(operationId: "cmd-x", revision: 4))
  }

  @Test func a_notice_does_not_need_the_keys_the_marker_does() throws {
    // A receipt from before a revision was recorded still words its notice.
    let receipt = try #require(Receipt(try json(#"{"operationId":"c","message":"Reopened"}"#)))
    let task = try #require(TodoTask(TestWorkspace.task("t", status: "cancelled")))
    let today = try Self.day("2026-11-26")
    #expect(
      RowNotice.text(after: .restore, task: task, pageDate: today, today: today, receipt: receipt, plannedAfter: today)
        == "Restored")
  }
}
