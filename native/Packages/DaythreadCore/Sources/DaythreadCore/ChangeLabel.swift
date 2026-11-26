/// The words an outbox entry carries to say what a change was (`labelFor` in `src/components/outbox.ts`). Only the
/// actions this build sends, and the fallback for any other.
public enum ChangeLabel {
  public static func text(for action: JSONValue, in workspace: Workspace) -> String {
    let object = action.objectValue
    let quoted = name(of: object, in: workspace).map { "\"\(cut($0))\"" }
    switch Command.type(of: action) {
    case "task-status":
      guard let quoted else { return "a change" }
      let verb =
        switch object?["status"]?.stringValue {
        case "done": "ticked"
        case "open": "unticked"
        default: "changed"
        }
      return "\(verb) \(quoted)"
    default:
      return quoted.map { "a change on \($0)" } ?? "a change"
    }
  }

  /// The to-do's title, else the page's, else the action's own `title`; an empty one is no name.
  private static func name(of action: JSONObject?, in workspace: Workspace) -> String? {
    let taskTitle = action?["taskId"]?.stringValue.flatMap(workspace.task)?.title
    let pageId = action?["rowId"]?.stringValue ?? action?["pageId"]?.stringValue
    let pageTitle = pageId.flatMap(workspace.page)?.title
    return [taskTitle, pageTitle, action?["title"]?.stringValue].lazy.compactMap { $0 }.first { !$0.isEmpty }
  }

  /// Forty UTF-16 units at most, as JavaScript counts them: longer is cut to 39 and an ellipsis.
  private static func cut(_ text: String) -> String {
    let units = Array(text.utf16)
    guard units.count > 40 else { return text }
    return String(decoding: units[..<39], as: UTF16.self) + "\u{2026}"
  }
}
