import DaythreadCore

public enum StoreError: Error, Equatable, Sendable {
  /// What is stored cannot be read back as a workspace or an outbox entry.
  case unreadable
  /// The call needs a workspace to be kept first (`replace`).
  case noWorkspace
  /// No entry has this `seq`.
  case noSuchEntry(seq: Int)
  /// The changes given to `write` name a row the workspace given with them lacks, so they are not what made it.
  case notInWorkspace(id: String)
}

/// Where the workspace and the outbox are kept on the device. Every call that writes lands whole
/// or not at all.
public protocol WorkspaceStore: Sendable {
  /// What is kept, or nil when nothing is. Throws `StoreError.unreadable` rather than return part of it.
  func load() async throws -> (workspace: Workspace, owner: String)?
  /// Keeps `workspace` for `owner`. Another owner's rows and outbox entries go first.
  func replace(with workspace: Workspace, owner: String) async throws
  /// Keeps `workspace`, which is what `changed` turned the kept one into; only the rows `changed` names are written.
  /// Changes that write a row `workspace` lacks are refused, with nothing written.
  func write(_ workspace: Workspace, changed: WorkspaceChanges) async throws
  /// The stored owner's entries, by `seq`.
  func entries() async throws -> [OutboxEntry]
  /// Numbers and keeps `entry`; a `seq` is never given twice.
  func append(_ entry: NewOutboxEntry) async throws -> OutboxEntry
  /// Keeps the new `baseRevision`, `ownRevisions`, `state` and `reason` of an entry that is there.
  func update(_ entry: OutboxEntry) async throws
  func remove(seq: Int) async throws
  /// In one transaction: removes the entry `seq` and, when `revision` is given, appends it to the `ownRevisions` of
  /// every later entry of the stored owner that does not have it yet. A `seq` that is not there changes nothing.
  func acknowledge(seq: Int, revision: Int?) async throws
  /// Forgets everything, `seq` included.
  func erase() async throws
}
