/// A `@date` chip in a line, as `readMention` in `src/domain/date-chip.ts` reads it.
struct DateMention {
  let date: LocalDate
  /// `HH:mm`, or nil when the chip has none or its time is not one.
  let time: String?

  /// The chip in one inline item, or nil: anything malformed (no id, an impossible date) is not a chip.
  init?(_ item: JSONValue) {
    guard
      let object = item.objectValue, object["type"]?.stringValue == "dateMention",
      let eventId = object["props"]?.objectValue?["eventId"]?.stringValue, !eventId.isEmpty,
      let date = object["props"]?.objectValue?["date"]?.stringValue.flatMap({ LocalDate($0) }),
      // `validDate` in `src/domain/date-chip.ts` builds the day with `Date.UTC`, which reads years
      // 0 to 99 as 19xx, so a chip dated before the year 100 is not a chip.
      !date.value.hasPrefix("00")
    else { return nil }
    self.date = date
    time = object["props"]?.objectValue?["time"]?.stringValue.flatMap { Self.validTime($0) ? $0 : nil }
  }

  private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

  /// The chip as stored text: `@Nov 20`, `@Nov 20 3pm`, and the year when it is not the year of the page
  /// holding the line (`@Jan 5, 2027`). A page with no date always gets the year.
  func text(pageDate: LocalDate?) -> String {
    let parts = date.value.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return "" }
    let (year, month, day) = (parts[0], parts[1], parts[2])
    let sameYear = pageDate.map { $0.value.prefix(4) == String(year) } ?? false
    var text = "@\(Self.months[month - 1]) \(day)"
    if !sameYear { text += ", \(year)" }
    if let time { text += " \(Self.timeLabel(time))" }
    return text
  }

  /// `15:00` reads `3pm`, `09:30` `9:30am`, `12:00` `12pm`, `00:15` `12:15am`.
  static func timeLabel(_ time: String) -> String {
    let parts = time.split(separator: ":").compactMap { Int($0) }
    guard parts.count == 2 else { return time }
    let (hour, minute) = (parts[0], parts[1])
    let clock = hour % 12 == 0 ? 12 : hour % 12
    return "\(clock)\(minute == 0 ? "" : ":" + (minute < 10 ? "0" : "") + String(minute))\(hour < 12 ? "am" : "pm")"
  }

  /// `HH:mm`, 00:00 to 23:59, ASCII digits only.
  private static func validTime(_ text: String) -> Bool {
    let bytes = Array(text.utf8)
    guard bytes.count == 5, bytes[2] == UInt8(ascii: ":") else { return false }
    func digit(_ i: Int) -> Int? {
      bytes[i] >= UInt8(ascii: "0") && bytes[i] <= UInt8(ascii: "9") ? Int(bytes[i] - UInt8(ascii: "0")) : nil
    }
    guard let h1 = digit(0), let h2 = digit(1), let m1 = digit(3), let m2 = digit(4) else { return false }
    return h1 * 10 + h2 <= 23 && m1 * 10 + m2 <= 59
  }
}
