import DaythreadCore
import Foundation
import SwiftData

// MARK: - Schema

/// Plain rows, no relationships: a page and a task are kept as the server sent them (`json`), next to
/// the position that keeps the list in order.
enum SchemaV1: VersionedSchema {
  static let versionIdentifier = Schema.Version(1, 0, 0)
  static var models: [any PersistentModel.Type] {
    [PageRow.self, TaskRow.self, MetaRow.self, OutboxRow.self]
  }

  @Model final class PageRow {
    @Attribute(.unique) var id: String
    var position: Int
    var json: String
    init(id: String, position: Int, json: String) {
      self.id = id
      self.position = position
      self.json = json
    }
  }

  @Model final class TaskRow {
    @Attribute(.unique) var id: String
    var position: Int
    var json: String
    init(id: String, position: Int, json: String) {
      self.id = id
      self.position = position
      self.json = json
    }
  }

  /// The one row holding what is not a page or a task: the owner, the revision, the workspace's other
  /// fields as JSON, and the number the next outbox entry gets.
  @Model final class MetaRow {
    @Attribute(.unique) var key: Int
    var owner: String
    var revision: Int
    /// The workspace's top-level object with `pages` and `tasks` emptied, so its field order is kept.
    var restJSON: String
    var nextSeq: Int
    init(owner: String, revision: Int, restJSON: String, nextSeq: Int) {
      key = 0
      self.owner = owner
      self.revision = revision
      self.restJSON = restJSON
      self.nextSeq = nextSeq
    }
  }

  @Model final class OutboxRow {
    @Attribute(.unique) var seq: Int
    var kind: String
    var owner: String
    var operationId: String
    var actionJSON: String
    var baseRevision: Int
    var ownRevisionsJSON: String
    var label: String
    var createdAt: Date
    var state: String
    var reason: String?
    init(
      seq: Int, kind: String, owner: String, operationId: String, actionJSON: String,
      baseRevision: Int, ownRevisionsJSON: String, label: String, createdAt: Date, state: String,
      reason: String?
    ) {
      self.seq = seq
      self.kind = kind
      self.owner = owner
      self.operationId = operationId
      self.actionJSON = actionJSON
      self.baseRevision = baseRevision
      self.ownRevisionsJSON = ownRevisionsJSON
      self.label = label
      self.createdAt = createdAt
      self.state = state
      self.reason = reason
    }
  }
}

typealias PageRow = SchemaV1.PageRow
typealias TaskRow = SchemaV1.TaskRow
typealias MetaRow = SchemaV1.MetaRow
typealias OutboxRow = SchemaV1.OutboxRow

/// No stages yet; a later schema version adds them.
enum StoreMigrationPlan: SchemaMigrationPlan {
  static var schemas: [any VersionedSchema.Type] { [SchemaV1.self] }
  static var stages: [MigrationStage] { [] }
}

/// A page or task row: what `reposition` and `rows` need of both.
protocol ListRow: PersistentModel {
  var id: String { get }
  var position: Int { get set }
  var json: String { get set }
  /// The rows with these ids (a predicate cannot be written once for both kinds).
  static func fetch(ids: [String], in context: ModelContext) throws -> [Self]
}

extension PageRow: ListRow {
  static func fetch(ids: [String], in context: ModelContext) throws -> [PageRow] {
    try context.fetch(FetchDescriptor<PageRow>(predicate: #Predicate { ids.contains($0.id) }))
  }
}

extension TaskRow: ListRow {
  static func fetch(ids: [String], in context: ModelContext) throws -> [TaskRow] {
    try context.fetch(FetchDescriptor<TaskRow>(predicate: #Predicate { ids.contains($0.id) }))
  }
}

// MARK: - Store

/// Keeps the workspace and the outbox in a SwiftData store. Everything that touches a model happens
/// inside this actor; only plain values leave it.
@ModelActor
public actor SwiftDataWorkspaceStore: WorkspaceStore {
  /// Page and task rows written since the store was opened; tests read it to see which rows a write touched.
  private(set) var rowWrites = 0
  /// Saves since the store was opened; tests read it to see that a call is one transaction.
  private(set) var saves = 0

  /// Opens the store at `url`, creating its folder if needed; nil keeps it in memory only.
  public static func open(at url: URL?) throws -> SwiftDataWorkspaceStore {
    let schema = Schema(versionedSchema: SchemaV1.self)
    let configuration: ModelConfiguration
    if let url {
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      configuration = ModelConfiguration(schema: schema, url: url)
    } else {
      configuration = ModelConfiguration(
        UUID().uuidString, schema: schema, isStoredInMemoryOnly: true)
    }
    let container = try ModelContainer(
      for: schema, migrationPlan: StoreMigrationPlan.self, configurations: [configuration])
    return SwiftDataWorkspaceStore(modelContainer: container)
  }

  // MARK: Workspace

  public func load() async throws -> (workspace: Workspace, owner: String)? {
    guard let meta = try fetchMeta() else { return nil }
    guard var object = try Self.record(meta.restJSON).objectValue else { throw StoreError.unreadable }
    object["pages"] = .array(try rows(PageRow.self).map { try Self.record($0.json) })
    object["tasks"] = .array(try rows(TaskRow.self).map { try Self.record($0.json) })
    guard let workspace = Workspace(.object(object)) else { throw StoreError.unreadable }
    return (workspace, meta.owner)
  }

  public func replace(with workspace: Workspace, owner: String) async throws {
    try commit {
      let previous = try fetchMeta()
      for entry in try modelContext.fetch(FetchDescriptor<OutboxRow>()) where entry.owner != owner {
        modelContext.delete(entry)
      }
      for row in try modelContext.fetch(FetchDescriptor<PageRow>()) { modelContext.delete(row) }
      for row in try modelContext.fetch(FetchDescriptor<TaskRow>()) { modelContext.delete(row) }
      for (position, page) in workspace.pages.enumerated() {
        modelContext.insert(PageRow(id: page.id, position: position, json: Self.write(page.raw)))
        rowWrites += 1
      }
      for (position, task) in workspace.tasks.enumerated() {
        modelContext.insert(TaskRow(id: task.id, position: position, json: Self.write(task.raw)))
        rowWrites += 1
      }
      try keepMeta(of: workspace, owner: owner, replacing: previous)
    }
  }

  public func write(_ workspace: Workspace, changed: WorkspaceChanges) async throws {
    try commit {
      guard let meta = try fetchMeta() else { throw StoreError.noWorkspace }

      let removedPages = changed.removedPageIds
      let removedTasks = changed.removedTaskIds
      for row in try PageRow.fetch(ids: removedPages, in: modelContext) { modelContext.delete(row) }
      for row in try TaskRow.fetch(ids: removedTasks, in: modelContext) { modelContext.delete(row) }

      let pagesAdded = try upsert(
        workspace.pages.map { ($0.id, Self.write($0.raw)) }, named: changed.upsertedPageIds,
        as: PageRow.self
      ) { PageRow(id: $0, position: $1, json: $2) }
      let tasksAdded = try upsert(
        workspace.tasks.map { ($0.id, Self.write($0.raw)) }, named: changed.upsertedTaskIds,
        as: TaskRow.self
      ) { TaskRow(id: $0, position: $1, json: $2) }

      if changed.pagesReordered || pagesAdded || !removedPages.isEmpty {
        try reposition(PageRow.self, to: workspace.pages.map(\.id))
      }
      if changed.tasksReordered || tasksAdded || !removedTasks.isEmpty {
        try reposition(TaskRow.self, to: workspace.tasks.map(\.id))
      }
      try keepMeta(of: workspace, owner: meta.owner, replacing: meta)
    }
  }

  /// Writes the records of `list` whose ids are in `names`: the row's JSON when it is there, a new
  /// row at the record's place in the list when it is not. Answers whether any row was new.
  private func upsert<Row: ListRow>(
    _ list: [(id: String, json: String)], named names: [String], as type: Row.Type,
    make: (String, Int, String) -> Row
  ) throws -> Bool {
    guard !names.isEmpty else { return false }
    let wanted = Set(names.map(Self.key))
    var existing: [[UInt8]: Row] = [:]
    for row in try Row.fetch(ids: names, in: modelContext) { existing[Self.key(row.id)] = row }
    var added = false
    for (position, record) in list.enumerated() where wanted.contains(Self.key(record.id)) {
      if let row = existing[Self.key(record.id)] {
        row.json = record.json
      } else {
        modelContext.insert(make(record.id, position, record.json))
        added = true
      }
      rowWrites += 1
    }
    return added
  }

  /// Gives every row the position its id has in `ids`, rewriting only rows whose position differs.
  /// A row the list does not have goes.
  private func reposition<Row: ListRow>(_ type: Row.Type, to ids: [String]) throws {
    var positions: [[UInt8]: Int] = [:]
    for (position, id) in ids.enumerated() { positions[Self.key(id)] = position }
    for row in try rows(type) {
      guard let position = positions[Self.key(row.id)] else {
        modelContext.delete(row)
        continue
      }
      if row.position != position {
        row.position = position
        rowWrites += 1
      }
    }
  }

  private func keepMeta(of workspace: Workspace, owner: String, replacing previous: MetaRow?) throws {
    var object = workspace.json().objectValue ?? JSONObject()
    object["pages"] = .array([])
    object["tasks"] = .array([])
    let rest = JSON.write(.object(object))
    if let previous {
      previous.owner = owner
      previous.revision = workspace.revision
      previous.restJSON = rest
    } else {
      modelContext.insert(
        MetaRow(owner: owner, revision: workspace.revision, restJSON: rest, nextSeq: 1))
    }
  }

  // MARK: Outbox

  public func entries() async throws -> [OutboxEntry] {
    guard let owner = try fetchMeta()?.owner else { return [] }
    let descriptor = FetchDescriptor<OutboxRow>(
      predicate: #Predicate { $0.owner == owner }, sortBy: [SortDescriptor(\.seq)])
    return try modelContext.fetch(descriptor).map(Self.entry)
  }

  public func append(_ entry: NewOutboxEntry) async throws -> OutboxEntry {
    try commit {
      guard let meta = try fetchMeta() else { throw StoreError.noWorkspace }
      let numbered = entry.numbered(meta.nextSeq)
      meta.nextSeq += 1
      modelContext.insert(
        OutboxRow(
          seq: numbered.seq, kind: numbered.kind.rawValue, owner: numbered.owner,
          operationId: numbered.operationId, actionJSON: JSON.write(numbered.action),
          baseRevision: numbered.baseRevision,
          ownRevisionsJSON: Self.write(numbered.ownRevisions), label: numbered.label,
          createdAt: numbered.createdAt, state: numbered.state.rawValue, reason: numbered.reason))
      return numbered
    }
  }

  public func update(_ entry: OutboxEntry) async throws {
    try commit {
      guard let row = try outboxRow(seq: entry.seq) else {
        throw StoreError.noSuchEntry(seq: entry.seq)
      }
      row.ownRevisionsJSON = Self.write(entry.ownRevisions)
      row.state = entry.state.rawValue
      row.reason = entry.reason
    }
  }

  public func remove(seq: Int) async throws {
    try commit {
      if let row = try outboxRow(seq: seq) { modelContext.delete(row) }
    }
  }

  public func acknowledge(seq: Int, revision: Int?) async throws {
    try commit {
      guard let row = try outboxRow(seq: seq) else { return }
      modelContext.delete(row)
      guard let revision, let owner = try fetchMeta()?.owner else { return }
      let later = FetchDescriptor<OutboxRow>(predicate: #Predicate { $0.owner == owner && $0.seq > seq })
      for entry in try modelContext.fetch(later) {
        var revisions = try Self.revisions(entry.ownRevisionsJSON)
        guard !revisions.contains(revision) else { continue }
        revisions.append(revision)
        entry.ownRevisionsJSON = Self.write(revisions)
      }
    }
  }

  public func erase() async throws {
    try commit {
      for row in try modelContext.fetch(FetchDescriptor<PageRow>()) { modelContext.delete(row) }
      for row in try modelContext.fetch(FetchDescriptor<TaskRow>()) { modelContext.delete(row) }
      for row in try modelContext.fetch(FetchDescriptor<OutboxRow>()) { modelContext.delete(row) }
      for row in try modelContext.fetch(FetchDescriptor<MetaRow>()) { modelContext.delete(row) }
    }
  }

  // MARK: Helpers

  /// Runs `body` and saves once; if either fails, nothing it did is kept.
  private func commit<T>(_ body: () throws -> T) throws -> T {
    modelContext.autosaveEnabled = false
    do {
      let result = try body()
      try modelContext.save()
      saves += 1
      return result
    } catch {
      modelContext.rollback()
      throw error
    }
  }

  private func fetchMeta() throws -> MetaRow? {
    var descriptor = FetchDescriptor<MetaRow>()
    descriptor.fetchLimit = 1
    return try modelContext.fetch(descriptor).first
  }

  private func outboxRow(seq: Int) throws -> OutboxRow? {
    var descriptor = FetchDescriptor<OutboxRow>(predicate: #Predicate { $0.seq == seq })
    descriptor.fetchLimit = 1
    return try modelContext.fetch(descriptor).first
  }

  private func rows<Row: ListRow>(_ type: Row.Type) throws -> [Row] {
    try modelContext.fetch(FetchDescriptor<Row>(sortBy: [SortDescriptor(\.position)]))
  }

  /// Ids compare by code units, as they do in the domain.
  private static func key(_ id: String) -> [UInt8] { Array(id.utf8) }

  private static func record(_ text: String) throws -> JSONValue {
    guard let value = try? JSON.parse(text) else { throw StoreError.unreadable }
    return value
  }

  private static func write(_ object: JSONObject) -> String { JSON.write(.object(object)) }

  private static func write(_ numbers: [Int]) -> String {
    JSON.write(.array(numbers.map { .number(String($0)) }))
  }

  private static func revisions(_ text: String) throws -> [Int] {
    guard let values = try record(text).arrayValue else { throw StoreError.unreadable }
    var revisions: [Int] = []
    for value in values {
      guard let revision = value.intValue else { throw StoreError.unreadable }
      revisions.append(revision)
    }
    return revisions
  }

  private static func entry(_ row: OutboxRow) throws -> OutboxEntry {
    guard
      let kind = OutboxEntry.Kind(rawValue: row.kind),
      let state = OutboxEntry.State(rawValue: row.state)
    else { throw StoreError.unreadable }
    let ownRevisions = try revisions(row.ownRevisionsJSON)
    return OutboxEntry(
      seq: row.seq, kind: kind, owner: row.owner, operationId: row.operationId,
      action: try record(row.actionJSON), baseRevision: row.baseRevision,
      ownRevisions: ownRevisions, label: row.label, createdAt: row.createdAt, state: state,
      reason: row.reason)
  }
}
