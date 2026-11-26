import Testing

@testable import DaythreadCore

@Suite struct PredictionTests {
  @Test(arguments: try Fixtures.commandNames())
  func each_shared_case_predicts_exactly_its_rows(name: String) throws {
    let found = try Fixtures.commandCase(name)
    let before = try #require(Workspace(found.before))
    let after = try #require(Workspace(found.after))
    let predicted = before.predicting(found.action)

    for id in found.taskRows {
      let mine = try #require(predicted.task(id))
      let theirs = try #require(after.task(id))
      #expect(JSON.write(.object(mine.raw)) == JSON.write(.object(theirs.raw)), "task \(id) in \(name)")
    }
    #expect(predicted.tasks.map(\.id) == before.tasks.map(\.id), "\(name)")
    for task in before.tasks where !found.taskRows.contains(task.id) {
      #expect(predicted.task(task.id) == task, "task \(task.id) in \(name)")
    }
    #expect(predicted.pages == before.pages, "\(name)")
    #expect(predicted.revision == before.revision, "\(name)")
  }

  @Test(arguments: [
    #"{"type":"ensure-day","date":"2026-10-23"}"#,
    #"{"type":"restore-batch","trashId":"b1"}"#,
    #"{"type":"something-new"}"#,
    #"{"type":"task-status","status":"done"}"#,
    #"{"type":"task-status","taskId":"editor-task:r1","status":"waiting"}"#,
    #"{"type":"task-status","taskId":"editor-task:r1"}"#,
    "null",
  ])
  func an_action_it_does_not_know_changes_nothing(_ action: String) throws {
    let before = try #require(Workspace(try Fixtures.commandCase("tick").before))
    #expect(before.predicting(try json(action)) == before)
  }

  @Test func predicting_twice_is_the_same_as_the_server_applying_twice_in_status() throws {
    let tick = try Fixtures.commandCase("tick")
    let reopen = try Fixtures.commandCase("reopen")
    let before = try #require(Workspace(tick.before))
    let twice = before.predicting(tick.action).predicting(reopen.action)
    let expected = try #require(Workspace(reopen.after)).task("editor-task:r1")
    let mine = try #require(twice.task("editor-task:r1"))
    #expect(mine.status == .open)
    #expect(mine.doneOn == nil)
    #expect(mine.raw["doneOn"] == expected?.raw["doneOn"])
    #expect(mine.version == 3)
  }

  @Test func a_task_reads_its_done_day_and_version() throws {
    let tick = try Fixtures.commandCase("tick")
    let done = try #require(Workspace(tick.after)?.task("editor-task:r1"))
    #expect(done.doneOn?.value == "2026-10-22")
    #expect(done.version == 2)
    let open = try #require(Workspace(tick.before)?.task("editor-task:r2"))
    #expect(open.doneOn == nil)
  }

  @Test func a_page_reads_its_trash_id() throws {
    let page = try #require(Page(try json(#"{"id":"p","type":"document","title":"T","document":"[]","trashId":"b1"}"#)))
    #expect(page.trashId == "b1")
    for text in [
      #"{"id":"p","type":"document","title":"T","document":"[]"}"#,
      #"{"id":"p","type":"document","title":"T","document":"[]","trashId":null}"#,
      #"{"id":"p","type":"document","title":"T","document":"[]","trashId":4}"#,
    ] {
      #expect(try #require(Page(try json(text))).trashId == nil)
    }
  }
}
