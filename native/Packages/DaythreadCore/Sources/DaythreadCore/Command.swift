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
