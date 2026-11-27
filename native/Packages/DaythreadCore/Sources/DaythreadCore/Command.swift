import Foundation

/// The actions the client sends, as the JSON values the server reads. Keys are written in the order the web app
/// writes them, so a stored action and a rebuilt one are the same text.
public enum Command {
  /// `today` is left out when nil.
  public static func taskStatus(taskId: String, status: TodoTask.Status, today: LocalDate?) -> JSONValue {
    var action = JSONObject()
    action["type"] = .string("task-status")
    action["taskId"] = .string(taskId)
    action["status"] = .string(status.rawValue)
    if let today { action["today"] = .string(today.value) }
    return .object(action)
  }

  /// `at` is written as `Date.toISOString()` does, in UTC with milliseconds; `singleDeleteIds` is left out when empty.
  public static func saveEditor(
    pageId: String, expectedContent: String, document: String, singleDeleteIds: [String], today: LocalDate,
    at: Date
  ) -> JSONValue {
    var action = JSONObject()
    action["type"] = .string("save-editor")
    action["pageId"] = .string(pageId)
    action["expectedContent"] = .string(expectedContent)
    action["document"] = .string(document)
    if !singleDeleteIds.isEmpty { action["singleDeleteIds"] = .array(singleDeleteIds.map { .string($0) }) }
    action["today"] = .string(today.value)
    action["at"] = .string(isoTime(at))
    return .object(action)
  }

  private static func isoTime(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }

  public static func ensureDay(_ date: LocalDate) -> JSONValue {
    var action = JSONObject()
    action["type"] = .string("ensure-day")
    action["date"] = .string(date.value)
    return .object(action)
  }

  public static func restoreBatch(trashId: String) -> JSONValue {
    var action = JSONObject()
    action["type"] = .string("restore-batch")
    action["trashId"] = .string(trashId)
    return .object(action)
  }

  /// `from` is the day of the page the row is on, and is left out when nil: a row brought to today from a past day
  /// stays there as history.
  public static func planTask(taskId: String, date: LocalDate, from: LocalDate?, today: LocalDate) -> JSONValue {
    var action = JSONObject()
    action["type"] = .string("plan-task")
    action["taskId"] = .string(taskId)
    action["date"] = .string(date.value)
    if let from { action["from"] = .string(from.value) }
    action["today"] = .string(today.value)
    return .object(action)
  }

  /// `date` is the day of the page the row is on; `onlyThisDay` is always sent, as the web sends it.
  public static func notToday(taskId: String, date: LocalDate) -> JSONValue {
    var action = JSONObject()
    action["type"] = .string("not-today")
    action["taskId"] = .string(taskId)
    action["date"] = .string(date.value)
    action["onlyThisDay"] = .bool(true)
    return .object(action)
  }

  public static func undo(targetOperationId: String) -> JSONValue {
    var action = JSONObject()
    action["type"] = .string("undo")
    action["targetOperationId"] = .string(targetOperationId)
    return .object(action)
  }

  /// `rowAction`: what a row action sends, from the day of the page the row is on. Nil for `pickDate`, which the
  /// screen turns into `move` once a day is picked.
  public static func forRow(_ action: RowAction, taskId: String, pageDate: LocalDate, today: LocalDate) -> JSONValue? {
    switch action {
    case .move(let date): planTask(taskId: taskId, date: date, from: pageDate, today: today)
    case .bringToToday, .planForTodayButton: planTask(taskId: taskId, date: today, from: nil, today: today)
    case .notToday: notToday(taskId: taskId, date: pageDate)
    case .cancel: taskStatus(taskId: taskId, status: .cancelled, today: today)
    case .restore: taskStatus(taskId: taskId, status: .open, today: today)
    case .pickDate: nil
    }
  }

  public static func type(of action: JSONValue) -> String? { action.objectValue?["type"]?.stringValue }

  /// The to-do a `task-status` names; nil for any other action.
  public static func taskId(of action: JSONValue) -> String? {
    guard type(of: action) == "task-status" else { return nil }
    return action.objectValue?["taskId"]?.stringValue
  }

  /// False for `task-status`, which touches only its own to-do's row; true for every other action, known or not,
  /// since this build cannot say what else the server changes for it.
  public static func readsBeyond(_ action: JSONValue) -> Bool { type(of: action) != "task-status" }
}
