/// The server's answer to a command, as far as a notice needs it.
public struct Receipt: Hashable, Sendable {
  public let message: String
  /// Nil only when `message` is not a string. `nextTodos` is read best-effort and only a cancel's notice uses it, so
  /// a list that does not read must not cost the notice of any other action. An entry that does not read is kept
  /// as nil, so it still counts as an entry: it is never the one, and never makes two read as one.
  public init?(_ json: JSONValue) {
    guard let object = json.objectValue, let message = object["message"]?.stringValue else { return nil }
    self.message = message
    nextEntries = object["nextTodos"]?.arrayValue?.map { $0.objectValue?["on"]?.stringValue.flatMap(LocalDate.init) } ?? []
  }

  private let nextEntries: [LocalDate?]

  /// The days of the to-dos a repeat made in that command, those that read.
  public var nextTodos: [LocalDate] { nextEntries.compactMap { $0 } }

  /// The day of the next to-do when the command made exactly one and it reads (`noticeWithNext`).
  var onlyNextTodo: LocalDate? {
    nextEntries.count == 1 ? nextEntries[0] : nil
  }
}

/// The words a row says after an action (`row-notices.ts`).
public enum RowNotice {
  /// `rowNoticeText`. `task` is the to-do as it was before the action; `plannedAfter` its planned day in the
  /// workspace after the answer. `pickDate` is never sent, so it never has a notice: it reads empty.
  public static func text(
    after action: RowAction, task: TodoTask, pageDate: LocalDate, today: LocalDate, receipt: Receipt,
    plannedAfter: LocalDate?
  ) -> String {
    switch action {
    case .move(let date): "Moved to \(DayWords.longLabel(date))"
    case .bringToToday: "On today"
    case .planForTodayButton: "Planned for today"
    case .notToday:
      // Compared by code units, as the web's `startsWith` does.
      receipt.message.utf8.starts(with: "Removed from".utf8)
        ? "Removed from \(DayWords.weekday(pageDate)) · still planned for \(DayWords.weekday(plannedAfter ?? pageDate))"
        : notToday(task: task, date: pageDate, today: today)
    case .cancel:
      // The next to-do's day, when the command made exactly one (`noticeWithNext`).
      receipt.onlyNextTodo.map { "Cancelled · Next \(DayWords.nextDayLabel($0, today: today))" } ?? "Cancelled"
    case .restore: "Restored"
    case .pickDate: ""
    }
  }

  /// `notTodayText`.
  private static func notToday(task: TodoTask, date: LocalDate, today: LocalDate) -> String {
    let head = date == today ? "Not today — won’t carry over" : "Not on \(DayWords.shortLabel(date))"
    guard let due = task.deadlineOn else { return head }
    return "\(head) · due \(DayWords.weekday(due)) still tracked"
  }

  public static let undone = "Undone"
  public static let cantUndo = "Can't undo · changed since"
  public static let couldntUndo = "Couldn't undo · your text is kept"
  public static let notDone = "Not done · your text is kept"
}
