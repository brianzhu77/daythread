import DaythreadCore

/// What the page list reads from the workspace for a document's rows, and nothing else: for each to-do row, its
/// to-do's status and whether it is paused, or that there is none yet (`BlockRows.todo`); for each page a line refers
/// to, that page's title (`InlineAttributedText`). Two workspaces with the same reading draw the document's rows
/// alike, so the day screen hands the list a new workspace only when the reading changes. A to-do's title is not here:
/// the list draws the row's own words.
struct ListReading: Equatable {
  struct Todo: Equatable {
    let status: TodoTask.Status
    let paused: Bool
  }

  /// By `taskId`; nil when the workspace has no such to-do.
  private(set) var todos: [String: Todo?] = [:]
  /// By page id; nil when the workspace has no such page.
  private(set) var pageTitles: [String: String?] = [:]

  init(of document: String, in workspace: Workspace) {
    var stack = Document.blocks(document)
    while let block = stack.popLast() {
      if block.type == "task" {
        let id = block.props["taskId"]?.stringValue ?? ""
        todos[id] = workspace.task(id).map { Todo(status: $0.status, paused: $0.paused) }
      }
      readPageRefs(in: block.content, from: workspace)
      stack.append(contentsOf: block.children)
    }
  }

  /// A line's items, and the items inside a link.
  private mutating func readPageRefs(in content: JSONValue?, from workspace: Workspace) {
    for item in content?.arrayValue ?? [] {
      guard let object = item.objectValue else { continue }
      if object["type"]?.stringValue == "pageRef", let id = object["props"]?.objectValue?["pageId"]?.stringValue {
        pageTitles[id] = workspace.page(id).map(\.title)
      }
      readPageRefs(in: object["content"], from: workspace)
    }
  }
}
