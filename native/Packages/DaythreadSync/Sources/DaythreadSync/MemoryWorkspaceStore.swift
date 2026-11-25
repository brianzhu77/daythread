import DaythreadCore

/// Keeps the workspace and the outbox in memory, for tests and previews.
public actor MemoryWorkspaceStore: WorkspaceStore {
  private var kept: (workspace: Workspace, owner: String)?
  private var outbox: [OutboxEntry] = []
  private var nextSeq = 1

  public init() {}

  public func load() async throws -> (workspace: Workspace, owner: String)? { kept }

  public func replace(with workspace: Workspace, owner: String) async throws {
    outbox.removeAll { $0.owner != owner }
    kept = (workspace, owner)
  }

  public func write(_ workspace: Workspace, changed: WorkspaceChanges) async throws {
    guard let owner = kept?.owner else { throw StoreError.noWorkspace }
    kept = (workspace, owner)
  }

  public func entries() async throws -> [OutboxEntry] {
    guard let owner = kept?.owner else { return [] }
    return outbox.filter { $0.owner == owner }
  }

  public func append(_ entry: NewOutboxEntry) async throws -> OutboxEntry {
    guard kept?.owner != nil else { throw StoreError.noWorkspace }
    let numbered = entry.numbered(nextSeq)
    nextSeq += 1
    outbox.append(numbered)
    return numbered
  }

  public func update(_ entry: OutboxEntry) async throws {
    guard let index = outbox.firstIndex(where: { $0.seq == entry.seq }) else {
      throw StoreError.noSuchEntry(seq: entry.seq)
    }
    outbox[index].ownRevisions = entry.ownRevisions
    outbox[index].state = entry.state
    outbox[index].reason = entry.reason
  }

  public func remove(seq: Int) async throws {
    outbox.removeAll { $0.seq == seq }
  }

  public func acknowledge(seq: Int, revision: Int?) async throws {
    guard outbox.contains(where: { $0.seq == seq }) else { return }
    outbox.removeAll { $0.seq == seq }
    guard let revision, let owner = kept?.owner else { return }
    for index in outbox.indices
    where outbox[index].owner == owner && outbox[index].seq > seq && !outbox[index].ownRevisions.contains(revision) {
      outbox[index].ownRevisions.append(revision)
    }
  }

  public func erase() async throws {
    kept = nil
    outbox = []
    nextSeq = 1
  }
}
