extension Workspace {
  /// The rows this build can predict for `action`, changed; `self` when it predicts nothing for it. Only a
  /// `task-status` on a to-do this workspace holds is predicted, and only the to-do's own row: what else the server
  /// does (the next to-do of a repeat, a day's page) arrives with the server's answer.
  public func predicting(_ action: JSONValue) -> Workspace {
    guard let taskId = Command.taskId(of: action), let object = action.objectValue,
      let word = object["status"]?.stringValue,
      case let status = TodoTask.Status(rawValue: word), !status.isOther,
      let index = tasks.firstIndex(where: { $0.id.hasSameCodeUnits(as: taskId) }),
      let version = tasks[index].version
    else { return self }

    // The server's own rule (`task-status` in `src/domain/workspace.ts`): doneOn is the day it was finished, or
    // null, and the version moves on every change.
    var row = tasks[index].raw
    row["status"] = .string(status.rawValue)
    if status == .done, let today = object["today"]?.stringValue, let day = LocalDate(today) {
      row["doneOn"] = .string(day.value)
    } else {
      row["doneOn"] = .null
    }
    row["version"] = .number(String(version + 1))
    guard let changed = TodoTask(.object(row)) else { return self }
    var copy = self
    copy.tasks[index] = changed
    return copy
  }
}

extension TodoTask.Status {
  fileprivate var isOther: Bool {
    if case .other = self { true } else { false }
  }
}
