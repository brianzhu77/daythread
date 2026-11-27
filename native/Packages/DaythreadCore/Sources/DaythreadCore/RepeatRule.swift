/// The rule of a repeating to-do (`TodoRepeatRule` in `src/domain/todo-repeats.ts`) without the end, which its words
/// never name.
public struct RepeatRule: Hashable, Sendable {
  public enum Every: String, Sendable { case day, week, month, year }
  public enum From: String, Sendable { case schedule, done }

  public let every: Every
  public let interval: Int
  /// 0 is Sunday. Only a weekly schedule names them.
  public let weekdays: [Int]?
  public let from: From

  /// Reads a repeat record, or a rule alone. Nil when `every` or `from` is a word this build does not know, `interval`
  /// is not a whole number from 1, or `weekdays` is present and not a list of days 0 to 6: the server stores no such
  /// rule, and one that does not read is left out rather than drawn wrongly.
  public init?(_ json: JSONValue) {
    guard let object = json.objectValue,
      let every = object["every"]?.stringValue.flatMap(Every.init(rawValue:)),
      let from = object["from"]?.stringValue.flatMap(From.init(rawValue:)),
      let interval = object["interval"]?.intValue, interval >= 1
    else { return nil }
    var weekdays: [Int]?
    switch object["weekdays"] {
    case nil, .null?: break
    case .array(let items)?:
      var days: [Int] = []
      for item in items {
        guard let day = item.intValue, (0...6).contains(day) else { return nil }
        days.append(day)
      }
      weekdays = days
    default: return nil
    }
    self.every = every
    self.interval = interval
    self.weekdays = weekdays
    self.from = from
  }

  private static let dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  /// `repeatWords`: "every week", "every 2 weeks on Mon, Thu", "every 5 days, from when it's done".
  public var words: String {
    var words = interval == 1 ? "every \(every.rawValue)" : "every \(interval) \(every.rawValue)s"
    if from == .done { return "\(words), from when it's done" }
    if let weekdays, !weekdays.isEmpty { words += " on " + weekdays.sorted().map { Self.dayNames[$0] }.joined(separator: ", ") }
    return words
  }

  /// `repeatMarkName`: "Repeats every week".
  public var markName: String { "Repeats \(words)" }
}

public enum Blockers {
  /// `blockedByWords`: "Blocked by Buy paint" for one, "Blocked by 2" for more; nil for none.
  public static func words(_ blockers: [TodoTask]) -> String? {
    switch blockers.count {
    case 0: nil
    case 1: "Blocked by \(blockers[0].title)"
    default: "Blocked by \(blockers.count)"
    }
  }
}
