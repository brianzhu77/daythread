import DaythreadCore
import Testing

@testable import DaythreadUI

private let today = LocalDate("2026-11-25")!
private let yesterday = LocalDate("2026-11-24")!
private let tomorrow = LocalDate("2026-11-26")!

private func page(_ id: String, type: String = "daily", date: LocalDate, trashedAt: String? = nil) -> String {
  let trash = trashedAt.map { #","trashedAt":"\#($0)","trashId":"trash-\#(id)""# } ?? ""
  return #"{"id":"\#(id)","type":"\#(type)","date":"\#(date.value)","title":"","document":"[]"\#(trash)}"#
}

private func workspace(_ pages: String...) throws -> Workspace {
  let text = #"{"revision":1,"timezone":"UTC","pages":[\#(pages.joined(separator: ","))],"tasks":[]}"#
  return try #require(Workspace(try JSON.parse(text)))
}

/// What the day screen shows for a date: the spec's table of a day with no page, and the day's live page otherwise.
@Suite struct DayContentTests {
  @Test func a_day_with_its_page_shows_it() throws {
    let w = try workspace(page("day:2026-11-24", date: yesterday))
    #expect(DayContent.content(for: yesterday, today: today, in: w) == .page(try #require(w.page("day:2026-11-24"))))
  }

  @Test func today_with_no_page_and_none_in_trash_is_asked_for() throws {
    let w = try workspace(page("day:2026-11-24", date: yesterday))
    #expect(DayContent.content(for: today, today: today, in: w) == .askingForToday)
  }

  @Test func a_past_day_with_no_page_has_none() throws {
    #expect(DayContent.content(for: yesterday, today: today, in: try workspace()) == .noPage)
  }

  @Test func a_future_day_with_no_page_has_not_happened() throws {
    #expect(DayContent.content(for: tomorrow, today: today, in: try workspace()) == .notYet)
  }

  @Test func a_day_whose_page_is_in_trash_says_so() throws {
    let w = try workspace(page("day:2026-11-24", date: yesterday, trashedAt: "2026-11-24T10:00:00.000Z"))
    #expect(DayContent.content(for: yesterday, today: today, in: w) == .inTrash(try #require(w.page("day:2026-11-24"))))
  }

  @Test func today_with_its_page_in_trash_is_in_trash_and_never_asked_for() throws {
    let w = try workspace(page("day:2026-11-25", date: today, trashedAt: "2026-11-25T08:00:00.000Z"))
    #expect(DayContent.content(for: today, today: today, in: w) == .inTrash(try #require(w.page("day:2026-11-25"))))
  }

  @Test func a_day_whose_only_page_is_a_draft_has_none() throws {
    let w = try workspace(page("draft:2026-11-24", type: "draft", date: yesterday))
    #expect(DayContent.content(for: yesterday, today: today, in: w) == .noPage)
  }

  @Test func a_past_day_shows_the_page_started_after_one_went_to_trash() throws {
    let w = try workspace(
      page("day:2026-11-24", date: yesterday, trashedAt: "2026-11-24T10:00:00.000Z"),
      page("day:2026-11-24:2", date: yesterday))
    #expect(DayContent.content(for: yesterday, today: today, in: w) == .page(try #require(w.page("day:2026-11-24:2"))))
  }
}
