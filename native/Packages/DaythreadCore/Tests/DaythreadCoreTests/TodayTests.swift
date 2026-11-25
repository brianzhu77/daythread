import Foundation
import Testing

@testable import DaythreadCore

@Suite(.serialized) struct TodayTests {
  static func instant(_ text: String) throws -> Date {
    try Date(text, strategy: .iso8601)
  }

  @Test func every_shared_case_gives_the_accounts_day() throws {
    let cases = try #require(try Fixtures.json("today/cases.json").arrayValue)
    #expect(cases.count >= 12)
    for entry in cases {
      let object = try #require(entry.objectValue)
      let timezone = try #require(object["timezone"]?.stringValue)
      let at = try Self.instant(try #require(object["at"]?.stringValue))
      let day = try #require(object["day"]?.stringValue)
      #expect(LocalDate.today(in: timezone, at: at).value == day, "\(timezone) at \(object["at"]?.stringValue ?? "")")
    }
  }

  @Test func the_devices_time_zone_never_decides_the_day() throws {
    let saved = NSTimeZone.default
    defer { NSTimeZone.default = saved }
    NSTimeZone.default = try #require(TimeZone(identifier: "Asia/Tokyo"))
    // In Tokyo these instants are the 22nd and the 23rd; in Vancouver they are the 21st and the 22nd.
    #expect(LocalDate.today(in: "America/Vancouver", at: try Self.instant("2026-10-22T06:30:00Z")).value == "2026-10-21")
    #expect(LocalDate.today(in: "America/Vancouver", at: try Self.instant("2026-10-22T16:00:00Z")).value == "2026-10-22")
  }

  @Test func the_midnight_after_the_clock_change_is_the_next_day() throws {
    #expect(LocalDate.today(in: "America/Vancouver", at: try Self.instant("2026-03-09T06:59:00Z")).value == "2026-03-08")
    #expect(LocalDate.today(in: "America/Vancouver", at: try Self.instant("2026-03-09T07:00:00Z")).value == "2026-03-09")
  }

  @Test func a_zone_the_system_does_not_know_reads_as_gmt() throws {
    let at = try Self.instant("2026-10-22T23:30:00Z")
    #expect(LocalDate.today(in: "Mars/Olympus_Mons", at: at).value == "2026-10-22")
    #expect(LocalDate.today(in: "", at: at).value == "2026-10-22")
  }

  @Test func a_year_is_written_with_four_digits() throws {
    #expect(LocalDate.today(in: "UTC", at: Date(timeIntervalSince1970: 0)).value == "1970-01-01")
  }

  @Test func a_date_is_a_real_day_in_the_shape_year_month_day() {
    for value in ["2026-10-22", "2024-02-29", "2000-02-29", "9999-12-31", "0100-01-01", "0026-10-22", "0000-01-01", "0099-12-31", "0000-02-29"] {
      #expect(LocalDate(value)?.value == value, "\(value)")
    }
    for value in [
      "2026-02-30", "2025-02-29", "1900-02-29", "0001-02-29", "2026-13-01", "2026-00-10", "2026-10-00", "2026-10-32",
      "2026-4-5", "26-10-22", "2026/10/22", "2026-10-22 ", " 2026-10-22", "2026-10-22\n", "", "٢٠٢٦-١٠-٢٢",
    ] {
      #expect(LocalDate(value) == nil, "\(value.debugDescription)")
    }
  }

  @Test func dates_order_by_their_text() throws {
    let a = try #require(LocalDate("2026-10-22"))
    let b = try #require(LocalDate("2026-11-01"))
    #expect(a < b)
    #expect(!(b < a))
    #expect([b, a].sorted() == [a, b])
  }
}
