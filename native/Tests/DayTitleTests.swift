import DaythreadCore
import DaythreadUI
import Foundation
import Testing

/// Serialized: one test changes the process's default time zone.
@Suite(.serialized) struct DayTitleTests {
  private let english = Locale(identifier: "en_US")

  @Test func readsWeekdayMonthAndDayWithoutTheYear() throws {
    let date = try #require(LocalDate("2026-10-22"))
    #expect(DayTitle.text(for: date, locale: english) == "Thursday, Oct 22")
  }

  @Test func showsTheDateItselfWhateverTheDevicesZone() throws {
    let saved = NSTimeZone.default
    defer { NSTimeZone.default = saved }
    // Midnight UTC on the 22nd is still the 21st in Los Angeles: a title made in the device's zone would read
    // "Wednesday, Oct 21".
    NSTimeZone.default = try #require(TimeZone(identifier: "America/Los_Angeles"))
    let date = try #require(LocalDate("2026-10-22"))
    #expect(DayTitle.text(for: date, locale: english) == "Thursday, Oct 22")
  }

  @Test(arguments: [
    ("2026-01-01", "Thursday, Jan 1"),
    ("2024-02-29", "Thursday, Feb 29"),
    ("2026-12-31", "Thursday, Dec 31"),
  ])
  func readsTheEdgesOfAYear(value: String, title: String) throws {
    let date = try #require(LocalDate(value))
    #expect(DayTitle.text(for: date, locale: english) == title)
  }
}
