import DaythreadCore
import Foundation

/// The title of a day's page: weekday, month and day in the reader's language, no year ("Thursday, Oct 22").
public enum DayTitle {
  /// The date's own day whatever the device's zone: it is read and written in UTC, in the Gregorian calendar.
  public static func text(for date: LocalDate, locale: Locale = .current) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    let parts = date.value.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3,
      let day = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    else { return date.value }
    let style = Date.FormatStyle(date: .omitted, time: .omitted, locale: locale, calendar: calendar, timeZone: .gmt)
      .weekday(.wide).month(.abbreviated).day()
    return day.formatted(style)
  }
}
