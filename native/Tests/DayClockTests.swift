import Foundation
import Testing

@testable import DaythreadUI

private func instant(_ text: String) throws -> Date {
  try #require(try? Date(text, strategy: .iso8601))
}

/// When Today moves: at the account's midnight, in the account's zone, never the device's.
@Suite struct DayClockTests {
  @Test func the_day_changes_at_the_accounts_midnight() throws {
    #expect(
      DayClock.nextChange(after: try instant("2026-11-25T15:59:00Z"), timezone: "Asia/Shanghai")
        == (try instant("2026-11-25T16:00:00Z")))
    // Havana's clocks go from 00:00 to 01:00 on 2026-03-08: that day starts at 01:00 local, 05:00 UTC.
    #expect(
      DayClock.nextChange(after: try instant("2026-03-08T04:30:00Z"), timezone: "America/Havana")
        == (try instant("2026-03-08T05:00:00Z")))
    #expect(
      DayClock.nextChange(after: try instant("2026-11-25T12:00:00Z"), timezone: "Nowhere/Nothing")
        == (try instant("2026-11-26T00:00:00Z")))
  }

  @Test func the_change_is_always_after_now() throws {
    let midnight = try instant("2026-11-26T00:00:00Z")
    #expect(DayClock.nextChange(after: midnight, timezone: "UTC") == (try instant("2026-11-27T00:00:00Z")))
  }
}
