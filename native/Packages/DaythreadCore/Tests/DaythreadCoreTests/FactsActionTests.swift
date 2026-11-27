import Testing

@testable import DaythreadCore

@Suite struct FactsActionTests {
  @Test func bring_back_and_another_day_are_written_as_the_web_writes_them() throws {
    let names = try Fixtures.factsActionNames()
    #expect(names.count == 4)
    for name in names {
      let entry = try Fixtures.factsActionCase(name)
      let written = Command.planTask(taskId: entry.taskId, date: entry.date, from: nil, today: entry.today)
      #expect(JSON.write(written) == JSON.write(entry.action), "action: \(name)")
      #expect(DayFacts.planNotice(date: entry.date, today: entry.today) == entry.notice, "notice: \(name)")
    }
  }

  @Test func the_answer_takes_the_to_do_out_of_not_today() throws {
    for name in try Fixtures.factsActionNames() {
      let entry = try Fixtures.factsActionCase(name)
      let before = DayFacts.of(
        day: entry.today, in: entry.before, index: TodoIndex(entry.before), today: entry.today)
      #expect(before.notToday?.rows.contains { $0.taskId == entry.taskId } == true, "before: \(name)")
      let after = DayFacts.of(
        day: entry.today, in: entry.after, index: TodoIndex(entry.after), today: entry.today)
      #expect(after.notToday?.rows.contains { $0.taskId == entry.taskId } != true, "after: \(name)")
      let marker = try #require(entry.after.undoMarker, "undo: \(name)")
      #expect(marker.operationId == "cmd-\(name)", "marker: \(name)")
      #expect(marker.revision == entry.after.revision, "revision: \(name)")
    }
  }
}
