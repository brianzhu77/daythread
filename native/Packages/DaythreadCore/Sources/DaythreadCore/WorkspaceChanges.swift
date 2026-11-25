/// What a command changed, as the server's reply carries it (`WorkspaceChanges` in
/// `src/domain/workspace-changes.ts`): the pages and tasks that differ, and whatever lists changed whole.
public struct WorkspaceChanges: Sendable {
  public let from: Int
  public let revision: Int
  public let upsertedPageIds: [String]
  public let removedPageIds: [String]
  public let pagesReordered: Bool
  public let upsertedTaskIds: [String]
  public let removedTaskIds: [String]
  public let tasksReordered: Bool

  struct ListChanges<Element: Identifiable & Sendable>: Sendable where Element.ID == String {
    var upsert: [Element]
    var remove: [String]
    /// Every id in the new order; only when applying `upsert` and `remove` in place would not give it.
    var order: [String]?
  }

  /// What the rules of the workspace become: left alone, taken away (`null`), or replaced whole.
  enum Rules: Sendable {
    case unchanged
    case cleared
    case replaced([JSONValue])
  }

  let timezone: String
  let weekStartIsMonday: Bool
  let todoAutomationsUnreadable: Bool
  /// An object, or nil when the changes carry none.
  let undo: JSONValue?
  let pages: ListChanges<Page>
  let tasks: ListChanges<TodoTask>
  let deletedTasks: [JSONValue]?
  let synced: [JSONValue]?
  let smartNotes: [JSONValue]?
  let threads: [JSONValue]?
  let links: [JSONValue]?
  let todoRepeats: [JSONValue]?
  let todoAutomations: Rules

  /// Nil when `from`, `revision`, `timezone`, `pages` or `tasks` is missing or malformed, or when a
  /// field the changes carry whole is not a list.
  public init?(_ json: JSONValue) {
    guard
      let object = json.objectValue, let from = object["from"]?.intValue,
      let revision = object["revision"]?.intValue, let timezone = object["timezone"]?.stringValue,
      let pages = Self.listChanges(object["pages"], Page.init),
      let tasks = Self.listChanges(object["tasks"], TodoTask.init)
    else { return nil }

    var lists: [String: [JSONValue]] = [:]
    for key in ["deletedTasks", "synced", "smartNotes", "threads", "links", "todoRepeats"] {
      switch object[key] {
      case nil, .null?: continue
      case .array(let items)?: lists[key] = items
      default: return nil
      }
    }
    switch object["undo"] {
    case nil, .null?: undo = nil
    case .object?: undo = object["undo"]
    default: return nil
    }
    switch object["todoAutomations"] {
    case nil: todoAutomations = .unchanged
    case .null?: todoAutomations = .cleared
    case .array(let items)?: todoAutomations = .replaced(items)
    default: return nil
    }

    self.from = from
    self.revision = revision
    self.timezone = timezone
    weekStartIsMonday = object["weekStart"]?.intValue == 1
    todoAutomationsUnreadable = object["todoAutomationsUnreadable"]?.boolValue == true
    self.pages = pages
    self.tasks = tasks
    deletedTasks = lists["deletedTasks"]
    synced = lists["synced"]
    smartNotes = lists["smartNotes"]
    threads = lists["threads"]
    links = lists["links"]
    todoRepeats = lists["todoRepeats"]
    upsertedPageIds = pages.upsert.map(\.id)
    removedPageIds = pages.remove
    pagesReordered = pages.order != nil
    upsertedTaskIds = tasks.upsert.map(\.id)
    removedTaskIds = tasks.remove
    tasksReordered = tasks.order != nil
  }

  private static func listChanges<Element>(
    _ value: JSONValue?, _ read: (JSONValue) -> Element?
  ) -> ListChanges<Element>? {
    guard
      let object = value?.objectValue, let upserts = object["upsert"]?.arrayValue,
      let removals = object["remove"]?.arrayValue
    else { return nil }
    var upsert: [Element] = []
    for item in upserts {
      guard let element = read(item) else { return nil }
      upsert.append(element)
    }
    var remove: [String] = []
    for item in removals {
      guard let id = item.stringValue else { return nil }
      remove.append(id)
    }
    var order: [String]?
    switch object["order"] {
    case nil, .null?: break
    case .array(let items)?:
      var ids: [String] = []
      for item in items {
        guard let id = item.stringValue else { return nil }
        ids.append(id)
      }
      order = ids
    default: return nil
    }
    return ListChanges(upsert: upsert, remove: remove, order: order)
  }
}

extension Workspace {
  /// The workspace after the command, or nil when this is not the copy the changes start from (or
  /// they name an order it cannot have), in which case the app loads the workspace whole instead.
  ///
  /// Ports `applyChanges` without its last step: pages stay as the server sent them.
  public func applying(_ changes: WorkspaceChanges) -> Workspace? {
    guard revision == changes.from,
      let pages = Self.apply(changes.pages, to: pages),
      let tasks = Self.apply(changes.tasks, to: tasks)
    else { return nil }

    var result = self
    result.revision = changes.revision
    result.timezone = changes.timezone
    result.pages = pages
    result.tasks = tasks

    for key in ["undo", "weekStart", "todoAutomationsUnreadable", "smartNotes", "threads", "links", "todoRepeats", "todoAutomations"] {
      result = result.setting(key, to: nil)
    }
    result = result.setting("receipts", to: .object(JSONObject()))
    if changes.weekStartIsMonday { result = result.setting("weekStart", to: .number("1")) }
    if changes.todoAutomationsUnreadable { result = result.setting("todoAutomationsUnreadable", to: .bool(true)) }
    if let deleted = changes.deletedTasks { result = result.setting("deletedTasks", to: .array(deleted)) }
    if let synced = changes.synced { result = result.setting("synced", to: .array(synced)) }

    // These stay when the changes do not carry them, and are left out when empty.
    let lists: [(String, [JSONValue]?, [JSONValue]?)] = [
      ("smartNotes", changes.smartNotes, rest["smartNotes"]?.arrayValue),
      ("threads", changes.threads, rest["threads"]?.arrayValue),
      ("links", changes.links, rest["links"]?.arrayValue),
      ("todoRepeats", changes.todoRepeats, rest["todoRepeats"]?.arrayValue),
    ]
    for (key, carried, held) in lists {
      if let items = carried ?? held, !items.isEmpty { result = result.setting(key, to: .array(items)) }
    }
    let rules: [JSONValue]? =
      switch changes.todoAutomations {
      case .unchanged: rest["todoAutomations"]?.arrayValue
      case .cleared: nil
      case .replaced(let items): items
      }
    if let rules, !rules.isEmpty { result = result.setting("todoAutomations", to: .array(rules)) }
    if let undo = changes.undo { result = result.setting("undo", to: undo) }
    return result
  }

  /// Existing entries replaced where they are, removed ones dropped, new ones appended in the order
  /// they came; then, when the changes name an order, exactly that order (nil if it does not fit).
  private static func apply<Element: Identifiable>(
    _ changes: WorkspaceChanges.ListChanges<Element>, to before: [Element]
  ) -> [Element]? where Element.ID == String {
    // Ids compare by code units, as they do in the domain.
    func key(_ id: String) -> [UInt8] { Array(id.utf8) }
    let gone = Set(changes.remove.map(key))
    var replaced: [[UInt8]: Element] = [:]
    for element in changes.upsert { replaced[key(element.id)] = element }
    var out = before.filter { !gone.contains(key($0.id)) }.map { replaced[key($0.id)] ?? $0 }
    let present = Set(out.map { key($0.id) })
    for element in changes.upsert where !present.contains(key(element.id)) { out.append(element) }

    guard let order = changes.order else { return out }
    var byId: [[UInt8]: Element] = [:]
    for element in out { byId[key(element.id)] = element }
    guard byId.count == order.count else { return nil }
    var ordered: [Element] = []
    for id in order {
      guard let element = byId[key(id)] else { return nil }
      ordered.append(element)
    }
    return ordered
  }
}
