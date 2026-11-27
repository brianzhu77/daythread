import Testing

@testable import DaythreadCore

@Suite struct RepeatTests {
  @Test func words_are_the_webs() throws {
    let cases = try Fixtures.json("repeats/words.json").arrayValue ?? []
    #expect(cases.count == 8)
    for (position, entry) in cases.enumerated() {
      let name = "case \(position)"
      let rule = try #require(entry.objectValue?["rule"].flatMap(RepeatRule.init), "rule: \(name)")
      #expect(rule.words == entry.objectValue?["words"]?.stringValue, "words: \(name)")
      #expect(rule.markName == entry.objectValue?["markName"]?.stringValue, "markName: \(name)")
    }
  }

  @Test func weekdays_are_sorted_and_only_a_scheduled_week_has_them() throws {
    let weekdays = JSONValue.array([.number("4"), .number("1"), .number("0")])
    let scheduled = try #require(RepeatRule(TestWorkspace.repeatRecord(taskId: "t", every: "week", weekdays: weekdays)))
    #expect(scheduled.words == "every week on Sun, Mon, Thu")
    let done = try #require(
      RepeatRule(TestWorkspace.repeatRecord(taskId: "t", every: "week", from: "done", weekdays: weekdays)))
    #expect(done.words == "every week, from when it's done")
    let empty = try #require(
      RepeatRule(TestWorkspace.repeatRecord(taskId: "t", every: "week", weekdays: .array([]))))
    #expect(empty.words == "every week")
  }

  @Test func a_rule_is_read_from_its_fields() throws {
    let rule = try #require(
      RepeatRule(TestWorkspace.repeatRecord(taskId: "t", every: "week", interval: .number("2"), from: "done")))
    #expect(rule.every == .week)
    #expect(rule.interval == 2)
    #expect(rule.from == .done)
    #expect(rule.weekdays == nil)
  }

  @Test func only_an_open_current_to_do_repeats() throws {
    let workspace = try TestWorkspace.make(
      tasks: [
        TestWorkspace.task("open"), TestWorkspace.task("done", status: "done"),
        TestWorkspace.task("cancelled", status: "cancelled"), TestWorkspace.task("previous", status: "done"),
        TestWorkspace.task("current"),
      ],
      rest: [
        (
          "todoRepeats",
          .array([
            TestWorkspace.repeatRecord(id: "a", taskId: "open"),
            TestWorkspace.repeatRecord(id: "b", taskId: "done"),
            TestWorkspace.repeatRecord(id: "c", taskId: "cancelled"),
            TestWorkspace.repeatRecord(id: "d", taskId: "current", every: "day"),
            TestWorkspace.repeatRecord(id: "e", taskId: "gone"),
          ])
        )
      ])
    let index = TodoIndex(workspace)
    #expect(index.repeatRule(of: "open")?.markName == "Repeats every week")
    #expect(index.repeatRule(of: "done") == nil)
    #expect(index.repeatRule(of: "cancelled") == nil)
    // The one before the current to-do is no repeat's current one.
    #expect(index.repeatRule(of: "previous") == nil)
    #expect(index.repeatRule(of: "current")?.markName == "Repeats every day")
    #expect(index.repeatRule(of: "gone") == nil)
  }

  @Test func the_later_repeat_of_a_to_do_is_the_one_read() throws {
    // `repeatsIn` builds a Map from the repeats in order: a later entry for the same to-do replaces an earlier one.
    let workspace = try TestWorkspace.make(
      tasks: [TestWorkspace.task("t")],
      rest: [
        (
          "todoRepeats",
          .array([
            TestWorkspace.repeatRecord(id: "a", taskId: "t", every: "day"),
            TestWorkspace.repeatRecord(id: "b", taskId: "t", every: "month"),
          ])
        )
      ])
    #expect(TodoIndex(workspace).repeatRule(of: "t")?.every == .month)
  }

  @Test func a_rule_that_does_not_read_marks_nothing() throws {
    let badRules: [JSONValue] = [
      TestWorkspace.repeatRecord(taskId: "t", every: "decade"),
      TestWorkspace.repeatRecord(taskId: "t", interval: .string("2")),
      TestWorkspace.repeatRecord(taskId: "t", interval: .number("0")),
      TestWorkspace.repeatRecord(taskId: "t", interval: .number("1.5")),
      TestWorkspace.repeatRecord(taskId: "t", from: "whenever"),
      TestWorkspace.repeatRecord(taskId: "t", weekdays: .string("Mon")),
      TestWorkspace.repeatRecord(taskId: "t", weekdays: .array([.number("7")])),
      .string("not a record"),
    ]
    let badRecords: [JSONValue] = [
      .object(["id": .string("h"), "every": .string("week"), "interval": .number("1"), "from": .string("schedule")]),
      .object([
        "id": .string("i"), "taskId": .number("3"), "every": .string("week"), "interval": .number("1"),
        "from": .string("schedule"),
      ]),
    ]
    for record in badRules {
      #expect(RepeatRule(record) == nil, "rule: \(record)")
    }
    for record in badRules + badRecords {
      let workspace = try TestWorkspace.make(
        tasks: [TestWorkspace.task("t")], rest: [("todoRepeats", .array([record]))])
      #expect(TodoIndex(workspace).repeatRule(of: "t") == nil, "record: \(record)")
    }
    // One that does not read leaves the others in force, and a field that is no array reads as none.
    let mixed = try TestWorkspace.make(
      tasks: [TestWorkspace.task("t"), TestWorkspace.task("u")],
      rest: [("todoRepeats", .array([badRules[0], TestWorkspace.repeatRecord(id: "ok", taskId: "u")]))])
    #expect(TodoIndex(mixed).repeatRule(of: "u")?.every == .week)
    let notAnArray = try TestWorkspace.make(
      tasks: [TestWorkspace.task("t")], rest: [("todoRepeats", .string("nope"))])
    #expect(TodoIndex(notAnArray).repeatRule(of: "t") == nil)
  }
}
