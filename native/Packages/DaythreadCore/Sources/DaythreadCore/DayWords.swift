/// The web's date words (`dates.ts`, `sinceLabel` in `row-marks.ts`, `nextDayLabel` in `todo-repeat-view.ts`): `en-US`
/// and the Gregorian calendar, written out so no device locale or time zone can change them.
public enum DayWords {
  // What `toLocaleDateString('en-US', { weekday: 'short' })` and `{ month: 'short' }` give in `dates.ts`.
  private static let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

  /// "Thu"
  public static func weekday(_ date: LocalDate) -> String { weekdays[date.weekday] }

  /// "Thu 11/26"
  public static func shortLabel(_ date: LocalDate) -> String {
    "\(weekday(date)) \(date.month)/\(date.day)"
  }

  /// "Thu, Nov 26"
  public static func longLabel(_ date: LocalDate) -> String {
    "\(weekday(date)), \(monthDay(date))"
  }

  /// "today", "tomorrow", a weekday inside the coming days, otherwise `shortLabel`. The web stops at 5 days ahead:
  /// 6 days ahead shares its weekday name with yesterday.
  public static func near(_ date: LocalDate, today: LocalDate) -> String {
    let diff = today.days(to: date)
    if diff == 0 { return "today" }
    if diff == 1 { return "tomorrow" }
    if diff > 1 && diff < 6 { return weekday(date) }
    return shortLabel(date)
  }

  /// "Nov 3", with the year when it is not `today`'s: "Nov 3, 2025".
  public static func sinceLabel(_ date: LocalDate, today: LocalDate) -> String {
    date.year == today.year ? monthDay(date) : "\(monthDay(date)), \(date.year)"
  }

  /// "Mon, Dec 7", with the year when it is not `today`'s: "Wed, Nov 24, 2027".
  public static func nextDayLabel(_ date: LocalDate, today: LocalDate) -> String {
    date.year == today.year ? longLabel(date) : "\(longLabel(date)), \(date.year)"
  }

  private static func monthDay(_ date: LocalDate) -> String { "\(months[date.month - 1]) \(date.day)" }
}
