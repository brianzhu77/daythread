import Foundation

/// A calendar day as the server writes it: `yyyy-MM-dd`.
public struct LocalDate: Hashable, Comparable, Sendable {
  public let value: String

  /// Nil unless `value` is a real calendar date in that shape. Years before 100 are refused, as the
  /// domain's `validDate` does (`Date.UTC` reads them as 19xx).
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
      year >= 100, (1...12).contains(month), day >= 1, day <= Self.daysIn(month: month, year: year)
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
