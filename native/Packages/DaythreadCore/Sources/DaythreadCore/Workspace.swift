/// The field that kept a record from reading: absent where it is required, or not what the record needs. Nil for a
/// record that is not an object at all.
private struct Unreadable: Error {
  let field: String?
}

extension JSONObject {
  /// A string, or nil when the key is absent or null. Anything else is unreadable.
  fileprivate func optionalString(_ key: String) throws(Unreadable) -> String? {
    guard let value = self[key], value != .null else { return nil }
    guard let text = value.stringValue else { throw Unreadable(field: key) }
    return text
  }

  fileprivate func requiredString(_ key: String) throws(Unreadable) -> String {
    guard let text = self[key]?.stringValue else { throw Unreadable(field: key) }
    return text
  }

  fileprivate func optionalDate(_ key: String) throws(Unreadable) -> LocalDate? {
    guard let text = try optionalString(key) else { return nil }
    guard let date = LocalDate(text) else { throw Unreadable(field: key) }
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

  /// A day's draft (`isDraft` in `src/domain/day-draft.ts`): a hidden page under its day page, whose
  /// `document` is the draft's own object, never an array of blocks.
  public var isDraft: Bool { type == "draft" }

  /// The batch a trashed page went to Trash in; nil when absent, null or not a string.
  public var trashId: String? { raw["trashId"]?.stringValue }

  /// Nil when `id`, `type`, `title` or `document` is not a string, or when `date`, `parentId` or
  /// `trashedAt` is present, not null and not a string (a date, for `date`).
  public init?(_ json: JSONValue) {
    try? self.init(reading: json)
  }

  fileprivate init(reading json: JSONValue) throws(Unreadable) {
    guard let raw = json.objectValue else { throw Unreadable(field: nil) }
    id = try raw.requiredString("id")
    type = try raw.requiredString("type")
    title = try raw.requiredString("title")
    document = try raw.requiredString("document")
    date = try raw.optionalDate("date")
    parentId = try raw.optionalString("parentId")
    trashedAt = try raw.optionalString("trashedAt")
    self.raw = raw
  }
}

/// A to-do, `Task` in the domain; renamed because Swift has its own `Task`.
public struct TodoTask: Hashable, Sendable, Identifiable {
  /// A word this build does not know is kept as `.other`, so a status a newer server adds neither hides the
  /// workspace nor is lost when it is written back.
  public enum Status: Hashable, Sendable {
    case open, done, cancelled
    case other(String)

    public init(rawValue: String) {
      switch rawValue {
      case "open": self = .open
      case "done": self = .done
      case "cancelled": self = .cancelled
      default: self = .other(rawValue)
      }
    }

    public var rawValue: String {
      switch self {
      case .open: "open"
      case .done: "done"
      case .cancelled: "cancelled"
      case .other(let word): word
      }
    }
  }

  public let id: String
  public let title: String
  public let status: Status
  public let paused: Bool
  public let deadlineOn: LocalDate?
  public let attentionOn: LocalDate?
  public let raw: JSONObject

  /// The day it was finished; nil when the row has none or it is null.
  public var doneOn: LocalDate? { raw["doneOn"]?.stringValue.flatMap(LocalDate.init) }

  /// How many times the server has changed the row.
  public var version: Int? { raw["version"]?.intValue }

  /// Nil when `id`, `title` or `status` is not a string,
  /// `paused` is not a boolean, or a date is present, not null and not a date.
  public init?(_ json: JSONValue) {
    try? self.init(reading: json)
  }

  fileprivate init(reading json: JSONValue) throws(Unreadable) {
    guard let raw = json.objectValue else { throw Unreadable(field: nil) }
    id = try raw.requiredString("id")
    title = try raw.requiredString("title")
    status = Status(rawValue: try raw.requiredString("status"))
    guard let paused = raw["paused"]?.boolValue else { throw Unreadable(field: "paused") }
    self.paused = paused
    deadlineOn = try raw.optionalDate("deadlineOn")
    attentionOn = try raw.optionalDate("attentionOn")
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
    guard case .success(let workspace) = Self.read(json) else { return nil }
    self = workspace
  }

  /// Why `init?` refuses `json`, or nil when it reads: the first field that fails, at the top level
  /// (`workspace: revision`), or in a row, named by its kind, its index in its array and its id when the id reads
  /// (`page 12 (id day:2026-10-22): date`, `task 3: id`). It never holds a title or any document text, so it can be
  /// logged.
  public static func unreadableReason(_ json: JSONValue) -> String? {
    guard case .failure(let reason) = read(json) else { return nil }
    return reason.text
  }

  private struct Reason: Error {
    let text: String

    init(text: String) { self.text = text }

    init(row kind: String, index: Int, _ value: JSONValue, _ error: Unreadable) {
      var text = "\(kind) \(index)"
      if let id = value.objectValue?["id"]?.stringValue { text += " (id \(id))" }
      text += ": \(error.field ?? "not an object")"
      self.text = text
    }
  }

  /// The one reading `init?` and `unreadableReason` share, so the two can never disagree.
  private static func read(_ json: JSONValue) -> Result<Workspace, Reason> {
    guard let raw = json.objectValue else { return .failure(Reason(text: "workspace: not an object")) }
    func top(_ field: String) -> Result<Workspace, Reason> { .failure(Reason(text: "workspace: \(field)")) }
    guard let revision = raw["revision"]?.intValue else { return top("revision") }
    guard let timezone = raw["timezone"]?.stringValue else { return top("timezone") }
    guard let pageValues = raw["pages"]?.arrayValue else { return top("pages") }
    guard let taskValues = raw["tasks"]?.arrayValue else { return top("tasks") }
    var pages: [Page] = []
    pages.reserveCapacity(pageValues.count)
    for (index, value) in pageValues.enumerated() {
      do throws(Unreadable) {
        pages.append(try Page(reading: value))
      } catch {
        return .failure(Reason(row: "page", index: index, value, error))
      }
    }
    var tasks: [TodoTask] = []
    tasks.reserveCapacity(taskValues.count)
    for (index, value) in taskValues.enumerated() {
      do throws(Unreadable) {
        tasks.append(try TodoTask(reading: value))
      } catch {
        return .failure(Reason(row: "task", index: index, value, error))
      }
    }
    return .success(Workspace(raw: raw, revision: revision, timezone: timezone, pages: pages, tasks: tasks))
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
}
