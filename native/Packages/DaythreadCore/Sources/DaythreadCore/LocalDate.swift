import Foundation

/// A calendar day as the server writes it: `yyyy-MM-dd`.
public struct LocalDate: Hashable, Comparable, Sendable {
  public let value: String

  /// Nil unless `value` is a real calendar date in that shape. Mirrors `date()` in
  /// `src/domain/workspace.ts`, which stores `deadlineOn`, `attentionOn` and the like: any four-digit
  /// year, 0000 included. (A `@date` chip is stricter; see `DateMention`.)
  public init?(_ value: String) {
    let digits = Array(value.utf8)
    guard digits.count == 10, digits[4] == UInt8(ascii: "-"), digits[7] == UInt8(ascii: "-") else { return nil }
    func number(_ range: Range<Int>) -> Int? {
      var n = 0
      for byte in digits[range] {
        guard byte >= UInt8(ascii: "0"), byte <= UInt8(ascii: "9") else { return nil }
        n = n * 10 + Int(byte - UInt8(ascii: "0"))
      }
      return n
    }
    guard let year = number(0..<4), let month = number(5..<7), let day = number(8..<10),
      (1...12).contains(month), day >= 1, day <= Self.daysIn(month: month, year: year)
    else { return nil }
    self.value = value
  }

  public static func < (lhs: LocalDate, rhs: LocalDate) -> Bool {
    lhs.value.utf8.lexicographicallyPrecedes(rhs.value.utf8)
  }

  /// The account's day for an instant: the day it is in `timezone`, never the device's. A zone the
  /// system does not know reads as GMT.
  public static func today(in timezone: String, at: Date) -> LocalDate {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: timezone) ?? .gmt
    let parts = calendar.dateComponents([.year, .month, .day], from: at)
    let year = parts.year ?? 1970, month = parts.month ?? 1, day = parts.day ?? 1
    let text = "\(pad(year, 4))-\(pad(month, 2))-\(pad(day, 2))"
    return LocalDate(unchecked: text)
  }

  /// The day `days` away, by the calendar alone (no zone, no daylight saving); nil outside years 0000 to 9999.
  public func adding(days: Int) -> LocalDate? {
    let (year, month, day) = Self.parts(of: value)
    let (shifted, overflow) = Self.daysSinceEpoch(year: year, month: month, day: day).addingReportingOverflow(days)
    guard !overflow else { return nil }
    let (y, m, d) = Self.civil(daysSinceEpoch: shifted)
    guard (0...9999).contains(y) else { return nil }
    return LocalDate(unchecked: "\(Self.pad(y, 4))-\(Self.pad(m, 2))-\(Self.pad(d, 2))")
  }

  /// The first instant of this day in `timezone` (an unknown zone reads as GMT, as `today(in:at:)` does). A day whose
  /// midnight a clock change skipped starts at the first instant that reads as it.
  public func start(in timezone: String) -> Date {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: timezone) ?? .gmt
    let (year, month, day) = Self.parts(of: value)
    let noon = DateComponents(calendar: calendar, timeZone: calendar.timeZone, year: year, month: month, day: day, hour: 12)
    return calendar.startOfDay(for: noon.date ?? Date(timeIntervalSince1970: 0))
  }

  /// Whether the system knows `timezone`; `today` reads one it does not know as GMT.
  public static func isKnown(timezone: String) -> Bool {
    TimeZone(identifier: timezone) != nil
  }

  private static func parts(of value: String) -> (year: Int, month: Int, day: Int) {
    let digits = value.utf8.map { Int($0) - 48 }
    return (
      digits[0] * 1000 + digits[1] * 100 + digits[2] * 10 + digits[3], digits[5] * 10 + digits[6],
      digits[8] * 10 + digits[9]
    )
  }

  // Days from 1970-01-01 and back, proleptic Gregorian (Howard Hinnant's civil-date algorithms).
  private static func daysSinceEpoch(year: Int, month: Int, day: Int) -> Int {
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yearOfEra = y - era * 400
    let dayOfYear = (153 * (month > 2 ? month - 3 : month + 9) + 2) / 5 + day - 1
    let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
    return era * 146_097 + dayOfEra - 719_468
  }

  private static func civil(daysSinceEpoch days: Int) -> (year: Int, month: Int, day: Int) {
    let z = days + 719_468
    let era = (z >= 0 ? z : z - 146_096) / 146_097
    let dayOfEra = z - era * 146_097
    let yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
    let dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
    let shiftedMonth = (5 * dayOfYear + 2) / 153
    let day = dayOfYear - (153 * shiftedMonth + 2) / 5 + 1
    let month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9
    return (yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day)
  }

  private init(unchecked value: String) { self.value = value }

  private static func pad(_ number: Int, _ width: Int) -> String {
    let digits = String(number)
    return String(repeating: "0", count: max(0, width - digits.count)) + digits
  }

  private static func daysIn(month: Int, year: Int) -> Int {
    switch month {
    case 2: (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 ? 29 : 28
    case 4, 6, 9, 11: 30
    default: 31
    }
  }
}
