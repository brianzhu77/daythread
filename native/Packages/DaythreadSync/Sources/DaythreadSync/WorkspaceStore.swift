import DaythreadCore

public enum StoreError: Error, Equatable, Sendable {
  /// What is stored cannot be read back as a workspace or an outbox entry.
  case unreadable
  /// The call needs a workspace to be kept first (`replace`).
  case noWorkspace
  /// No entry has this `seq`.
  case noSuchEntry(seq: Int)
}

/// Where the workspace and the outbox are kept on the device. Every call that writes lands whole
/// or not at all.
public protocol WorkspaceStore: Sendable {
  /// What is kept, or nil when nothing is. Throws `StoreError.unreadable` rather than return part of it.
  func load() async throws -> (workspace: Workspace, owner: String)?
  /// Keeps `workspace` for `owner`. Another owner's rows and outbox entries go first.
  func replace(with workspace: Workspace, owner: String) async throws
  /// Keeps `workspace`, which is what `changed` turned the kept one into; only the rows `changed` names are written.
  func write(_ workspace: Workspace, changed: WorkspaceChanges) async throws
  /// The stored owner's entries, by `seq`.
  func entries() async throws -> [OutboxEntry]
  /// Numbers and keeps `entry`; a `seq` is never given twice.
  func append(_ entry: NewOutboxEntry) async throws -> OutboxEntry
  /// Keeps the new `ownRevisions`, `state` and `reason` of an entry that is there.
  func update(_ entry: OutboxEntry) async throws
  func remove(seq: Int) async throws
  /// Forgets everything, `seq` included.
  func erase() async throws
}
