/// A field was present but not what the record needs.
private struct Unreadable: Error {}

extension JSONObject {
  /// A string, or nil when the key is absent or null. Anything else is unreadable.
  fileprivate func optionalString(_ key: String) throws -> String? {
    guard let value = self[key], value != .null else { return nil }
    guard let text = value.stringValue else { throw Unreadable() }
    return text
  }

  fileprivate func requiredString(_ key: String) throws -> String {
    guard let text = self[key]?.stringValue else { throw Unreadable() }
    return text
  }

  fileprivate func optionalDate(_ key: String) throws -> LocalDate? {
    guard let text = try optionalString(key) else { return nil }
    guard let date = LocalDate(text) else { throw Unreadable() }
    return date
  }
}

/// A page as the server sends it. Named fields are read from `raw`; everything else stays there.
public struct Page: Hashable, Sendable, Identifiable {
  public let id: String
  public let type: String
  public let date: LocalDate?
  public let title: String
  public let parentId: String?
  public let trashedAt: String?
  public let document: String
  /// Everything the server sent, for fields later phases read.
  public let raw: JSONObject

  /// Nil when `id`, `type`, `title` or `document` is not a string, or when `date`, `parentId` or
  /// `trashedAt` is present, not null and not a string (a date, for `date`).
  public init?(_ json: JSONValue) {
    guard let raw = json.objectValue else { return nil }
    do {
      id = try raw.requiredString("id")
      type = try raw.requiredString("type")
      title = try raw.requiredString("title")
      document = try raw.requiredString("document")
      date = try raw.optionalDate("date")
      parentId = try raw.optionalString("parentId")
      trashedAt = try raw.optionalString("trashedAt")
    } catch { return nil }
    self.raw = raw
  }
}

/// A to-do, `Task` in the domain; renamed because Swift has its own `Task`.
public struct TodoTask: Hashable, Sendable, Identifiable {
  public enum Status: String, Sendable { case open, done, cancelled }

  public let id: String
  public let title: String
  public let status: Status
  public let paused: Bool
  public let deadlineOn: LocalDate?
  public let attentionOn: LocalDate?
  public let raw: JSONObject

  /// Nil when `id` or `title` is not a string, `status` is not one of open, done and cancelled,
  /// `paused` is not a boolean, or a date is present, not null and not a date.
  public init?(_ json: JSONValue) {
    guard let raw = json.objectValue, let paused = raw["paused"]?.boolValue else { return nil }
    do {
      id = try raw.requiredString("id")
      title = try raw.requiredString("title")
      guard let status = Status(rawValue: try raw.requiredString("status")) else { throw Unreadable() }
      self.status = status
      deadlineOn = try raw.optionalDate("deadlineOn")
      attentionOn = try raw.optionalDate("attentionOn")
    } catch { return nil }
    self.paused = paused
    self.raw = raw
  }
}

/// The workspace in the form the server sends it. Like `Block`, it is written back through the
/// object it was read from, so what this package does not name is never lost.
///
/// Invariant: `raw` is always exactly what `json()` returns, and `revision`, `timezone`, `pages` and
/// `tasks` always agree with it. Every change to one of those four writes `raw` at once, and the
/// initialisers start from a `raw` that agrees, so the synthesised `==` and `hash` follow the JSON:
/// a workspace equals the workspace read back from its own `json()`.
public struct Workspace: Hashable, Sendable {
  public var revision: Int {
    didSet { if raw["revision"]?.intValue != revision { raw["revision"] = .number(String(revision)) } }
  }
  public var timezone: String {
    didSet {
      if !(raw["timezone"]?.stringValue?.hasSameCodeUnits(as: timezone) ?? false) {
        raw["timezone"] = .string(timezone)
      }
    }
  }
  public var pages: [Page] { didSet { raw["pages"] = .array(pages.map { .object($0.raw) }) } }
  public var tasks: [TodoTask] { didSet { raw["tasks"] = .array(tasks.map { .object($0.raw) }) } }
  /// The whole object, kept current (see the invariant above).
  private var raw: JSONObject

  private static let named = ["revision", "timezone", "pages", "tasks"]

  /// Nil when `revision` is not an integer, `timezone` not a string, `pages` or `tasks` not arrays,
  /// or any page or task in them is unreadable. Rows are never dropped quietly.
  public init?(_ json: JSONValue) {
    guard
      let raw = json.objectValue, let revision = raw["revision"]?.intValue,
      let timezone = raw["timezone"]?.stringValue,
      let pageValues = raw["pages"]?.arrayValue, let taskValues = raw["tasks"]?.arrayValue
    else { return nil }
    var pages: [Page] = []
    pages.reserveCapacity(pageValues.count)
    for value in pageValues {
      guard let page = Page(value) else { return nil }
      pages.append(page)
    }
    var tasks: [TodoTask] = []
    tasks.reserveCapacity(taskValues.count)
    for value in taskValues {
      guard let task = TodoTask(value) else { return nil }
      tasks.append(task)
    }
    self.init(raw: raw, revision: revision, timezone: timezone, pages: pages, tasks: tasks)
  }

  init(raw: JSONObject, revision: Int, timezone: String, pages: [Page], tasks: [TodoTask]) {
    self.raw = raw
    self.revision = revision
    self.timezone = timezone
    self.pages = pages
    self.tasks = tasks
  }

  /// Every other top-level field, as sent.
  public var rest: JSONObject {
    var rest = raw
    for key in Self.named { rest[key] = nil }
    return rest
  }

  /// The workspace as the server would send it: unchanged fields come out as they went in.
  public func json() -> JSONValue { .object(raw) }

  /// A copy whose top-level field `key` is set, or removed when `value` is nil (internal: `applying`).
  func setting(_ key: String, to value: JSONValue?) -> Workspace {
    var copy = self
    copy.raw[key] = value
    return copy
  }

  public func page(_ id: String) -> Page? { pages.first { $0.id.hasSameCodeUnits(as: id) } }

  public func task(_ id: String) -> TodoTask? { tasks.first { $0.id.hasSameCodeUnits(as: id) } }

  /// The page `day:<date>`.
  public func dayPage(_ date: LocalDate) -> Page? { page("day:\(date.value)") }
}
