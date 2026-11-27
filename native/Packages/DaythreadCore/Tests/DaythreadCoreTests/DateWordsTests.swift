import Testing

@testable import DaythreadCore

@Suite struct DateWordsTests {
  static func day(_ text: String) throws -> LocalDate { try #require(LocalDate(text)) }

  @Test func words_are_the_webs() throws {
    let cases = try Fixtures.cases("dates/words.json")
    #expect(cases.count == 24)
    for entry in cases {
      let date = try Self.day(try #require(entry["date"]?.stringValue))
      let today = try Self.day(try #require(entry["today"]?.stringValue))
      let name = "\(date.value) (today \(today.value))"
      #expect(today.days(to: date) == entry["daysBetween"]?.intValue, "daysBetween: \(name)")
      #expect(DayWords.weekday(date) == entry["weekday"]?.stringValue, "weekday: \(name)")
      #expect(DayWords.shortLabel(date) == entry["shortLabel"]?.stringValue, "shortLabel: \(name)")
      #expect(DayWords.longLabel(date) == entry["longLabel"]?.stringValue, "longLabel: \(name)")
      #expect(DayWords.near(date, today: today) == entry["near"]?.stringValue, "near: \(name)")
      #expect(DayWords.sinceLabel(date, today: today) == entry["sinceLabel"]?.stringValue, "sinceLabel: \(name)")
      #expect(
        DayWords.nextDayLabel(date, today: today) == entry["nextDayLabel"]?.stringValue, "nextDayLabel: \(name)")
    }
  }

  @Test func all_twelve_month_words_read_in_a_year_other_than_todays() throws {
    // The shared cases only reach November to February.
    let words = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    let today = try Self.day("2026-11-26")
    for (index, word) in words.enumerated() {
      let month = index + 1
      let date = try Self.day("2025-\(month < 10 ? "0" : "")\(month)-17")
      #expect(DayWords.sinceLabel(date, today: today) == "\(word) 17, 2025", "month \(month)")
    }
  }

  @Test func the_weekday_of_known_days() throws {
    #expect(try Self.day("2026-11-22").weekday == 0)
    #expect(try Self.day("2026-11-26").weekday == 4)
    #expect(try Self.day("2028-02-29").weekday == 2)
  }

  @Test func the_parts_of_a_day() throws {
    let date = try Self.day("2026-11-06")
    #expect(date.year == 2026)
    #expect(date.month == 11)
    #expect(date.day == 6)
  }
}
