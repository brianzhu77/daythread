import DaythreadCore
import Foundation

/// A day's name: weekday, month and day in the reader's language, no year. The long form ("Thursday, Oct 22") is the
/// one sentences use; the short form ("Thu, Oct 22"), the web's `longLabel`, is the day's title.
public enum DayTitle {
  /// The long form: "Thursday, Oct 22".
  public static func text(for date: LocalDate, locale: Locale = .current) -> String {
    format(date, weekday: .wide, locale: locale)
  }

  /// The short form, the header's title: "Thu, Oct 22".
  public static func short(for date: LocalDate, locale: Locale = .current) -> String {
    format(date, weekday: .abbreviated, locale: locale)
  }

  /// The date's own day whatever the device's zone: it is read and written in UTC, in the Gregorian calendar.
  private static func format(_ date: LocalDate, weekday: Date.FormatStyle.Symbol.Weekday, locale: Locale) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .gmt
    let parts = date.value.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3,
      let day = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    else { return date.value }
    let style = Date.FormatStyle(date: .omitted, time: .omitted, locale: locale, calendar: calendar, timeZone: .gmt)
      .weekday(weekday).month(.abbreviated).day()
    return day.formatted(style)
  }
}
