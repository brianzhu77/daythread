extension TodoTask {
  /// The day it was made; nil when the row has none or it is not a day.
  public var createdOn: LocalDate? { raw["createdOn"]?.stringValue.flatMap(LocalDate.init) }

  public var sourcePageId: String? { raw["sourcePageId"]?.stringValue }

  /// `hasDateFacts` in `row-marks.ts`: a Due or a Start date.
  public var hasDateFacts: Bool { deadlineOn != nil || attentionOn != nil }

  /// `deadlinePassed` in `dates.ts`: the Due date is before `today`.
  public func deadlinePassed(today: LocalDate) -> Bool {
    guard let due = deadlineOn else { return false }
    return today.days(to: due) < 0
  }
}

/// `taskDateTag` in `dates.ts`: the plain-phrase tag with only the fields that are set.
public enum DateTag {
  /// `planned`: the to-do's planned day; nil reads "Unscheduled" when no other date is set. "" when nothing is drawn.
  public static func text(for task: TodoTask, today: LocalDate, pageDate: LocalDate, planned: LocalDate?) -> String {
    var parts: [String] = []
    let due = task.deadlineOn
    let start = task.attentionOn
    if let due, today.days(to: due) < 0, pageDate.days(to: due) < 0 {
      return "Was due \(DayWords.weekday(due))"
    }
    if let due {
      if due == pageDate && pageDate != today {
        parts.append("Due that day")
      } else {
        parts.append("Due \(DayWords.near(due, today: today))")
      }
    }
    if let start, today.days(to: start) >= 0 {
      let startTag = "Start \(DayWords.near(start, today: today))"
      let dueFirst = due.map { today.days(to: $0) <= 2 } ?? false
      if dueFirst { parts.append(startTag) } else { parts.insert(startTag, at: 0) }
    }
    if parts.isEmpty && planned == nil { return "Unscheduled" }
    return parts.joined(separator: " · ")
  }
}
