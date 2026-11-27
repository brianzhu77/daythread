import Testing

@testable import DaythreadCore

@Suite struct CommandTests {
  private func written(_ value: JSONValue) -> String { JSON.write(value) }

  @Test func a_status_command_is_written_in_the_servers_key_order() throws {
    let today = try #require(LocalDate("2026-10-22"))
    #expect(
      written(Command.taskStatus(taskId: "t1", status: .done, today: today))
        == #"{"type":"task-status","taskId":"t1","status":"done","today":"2026-10-22"}"#)
    #expect(
      written(Command.taskStatus(taskId: "t1", status: .cancelled, today: today))
        == #"{"type":"task-status","taskId":"t1","status":"cancelled","today":"2026-10-22"}"#)
  }

  @Test func a_status_command_without_a_day_leaves_the_key_out() {
    #expect(
      written(Command.taskStatus(taskId: "t1", status: .open, today: nil))
        == #"{"type":"task-status","taskId":"t1","status":"open"}"#)
  }

  @Test func the_day_and_restore_commands_are_written() throws {
    #expect(
      written(Command.ensureDay(try #require(LocalDate("2026-10-23"))))
        == #"{"type":"ensure-day","date":"2026-10-23"}"#)
    #expect(written(Command.restoreBatch(trashId: "b1")) == #"{"type":"restore-batch","trashId":"b1"}"#)
  }

  @Test func only_a_status_change_stays_within_the_rows_it_names() throws {
    let day = try #require(LocalDate("2026-10-23"))
    #expect(Command.readsBeyond(Command.taskStatus(taskId: "t1", status: .done, today: nil)) == false)
    #expect(Command.readsBeyond(Command.ensureDay(day)))
    #expect(Command.readsBeyond(Command.restoreBatch(trashId: "b1")))
    #expect(Command.readsBeyond(try json(#"{"type":"something-new"}"#)))
    #expect(Command.readsBeyond(.null))
  }

  @Test func a_status_command_names_its_task_and_nothing_else_does() throws {
    #expect(Command.taskId(of: Command.taskStatus(taskId: "t1", status: .done, today: nil)) == "t1")
    #expect(Command.taskId(of: Command.ensureDay(try #require(LocalDate("2026-10-23")))) == nil)
    #expect(Command.taskId(of: Command.restoreBatch(trashId: "b1")) == nil)
    #expect(Command.taskId(of: try json(#"{"type":"task-status"}"#)) == nil)
    #expect(Command.taskId(of: .null) == nil)
  }

  @Test func pick_date_is_never_a_command() throws {
    let today = try #require(LocalDate("2026-11-26"))
    #expect(Command.forRow(.pickDate, taskId: "t", pageDate: today, today: today) == nil)
  }

  @Test func the_row_commands_are_written_in_the_webs_key_order() throws {
    let today = try #require(LocalDate("2026-11-26"))
    let friday = try #require(LocalDate("2026-11-27"))
    #expect(
      written(Command.planTask(taskId: "t", date: friday, from: today, today: today))
        == #"{"type":"plan-task","taskId":"t","date":"2026-11-27","from":"2026-11-26","today":"2026-11-26"}"#)
    #expect(
      written(Command.planTask(taskId: "t", date: today, from: nil, today: today))
        == #"{"type":"plan-task","taskId":"t","date":"2026-11-26","today":"2026-11-26"}"#)
    #expect(
      written(Command.notToday(taskId: "t", date: friday))
        == #"{"type":"not-today","taskId":"t","date":"2026-11-27","onlyThisDay":true}"#)
    #expect(
      written(Command.undo(targetOperationId: "cmd-1")) == #"{"type":"undo","targetOperationId":"cmd-1"}"#)
  }

  @Test func the_type_is_read_from_any_action() throws {
    #expect(Command.type(of: Command.restoreBatch(trashId: "b1")) == "restore-batch")
    #expect(Command.type(of: try json(#"{"type":"something-new"}"#)) == "something-new")
    #expect(Command.type(of: try json(#"{"type":3}"#)) == nil)
    #expect(Command.type(of: .null) == nil)
  }
}
