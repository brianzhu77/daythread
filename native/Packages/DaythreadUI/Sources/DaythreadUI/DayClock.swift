import DaythreadCore
import Foundation

/// When the account's day changes.
enum DayClock {
  /// The first instant after `now` at which the account's day is another day: the start of tomorrow in `timezone`
  /// (an unknown zone reads as GMT, as `LocalDate.today(in:at:)` does). A day whose midnight a clock change skipped
  /// starts at the first instant that reads as it.
  static func nextChange(after now: Date, timezone: String) -> Date {
    guard let tomorrow = LocalDate.today(in: timezone, at: now).adding(days: 1) else { return .distantFuture }
    return tomorrow.start(in: timezone)
  }
}
