import Testing

@testable import DaythreadCore

@Suite struct DateTagTests {
  static func task(deadlineOn: String?, attentionOn: String?) throws -> TodoTask {
    func field(_ value: String?) -> String { value.map { #""\#($0)""# } ?? "null" }
    return try #require(
      TodoTask(
        try json(
          #"{"id":"t","title":"T","status":"open","paused":false,"deadlineOn":\#(field(deadlineOn)),"attentionOn":\#(field(attentionOn))}"#
        )))
  }

  @Test func tags_are_the_webs() throws {
    let cases = try Fixtures.cases("dates/tags.json")
    #expect(cases.count == 102)
    for entry in cases {
      let name = entry["name"]?.stringValue ?? "?"
      let task = try Self.task(
        deadlineOn: entry["deadlineOn"]?.stringValue, attentionOn: entry["attentionOn"]?.stringValue)
      let today = try #require(entry["today"]?.stringValue.flatMap(LocalDate.init))
      let pageDate = try #require(entry["pageDate"]?.stringValue.flatMap(LocalDate.init))
      let planned = entry["planned"]?.stringValue.flatMap(LocalDate.init)
      #expect(
        DateTag.text(for: task, today: today, pageDate: pageDate, planned: planned) == entry["text"]?.stringValue,
        "text: \(name)")
      #expect(task.deadlinePassed(today: today) == entry["passed"]?.boolValue, "passed: \(name)")
    }
  }

  @Test func a_to_do_without_dates_has_no_date_facts() throws {
    #expect(try !Self.task(deadlineOn: nil, attentionOn: nil).hasDateFacts)
    #expect(try Self.task(deadlineOn: "2026-11-26", attentionOn: nil).hasDateFacts)
    #expect(try Self.task(deadlineOn: nil, attentionOn: "2026-11-26").hasDateFacts)
  }
}
