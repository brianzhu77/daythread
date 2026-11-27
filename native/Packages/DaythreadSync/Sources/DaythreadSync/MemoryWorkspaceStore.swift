import DaythreadCore

/// Keeps the workspace and the outbox in memory, for tests and previews.
public actor MemoryWorkspaceStore: WorkspaceStore {
  private var kept: (workspace: Workspace, owner: String)?
  private var outbox: [OutboxEntry] = []
  private var nextSeq = 1
  private var draftsKept: [DraftKey: PageDraft] = [:]

  /// Swift's `String` equality is canonical equivalence; ids are compared by code units everywhere else.
  private struct DraftKey: Hashable {
    let owner: [UInt8]
    let pageId: [UInt8]
    init(owner: String, pageId: String) {
      self.owner = Array(owner.utf8)
      self.pageId = Array(pageId.utf8)
    }
  }

  public init() {}

  public func load() async throws -> (workspace: Workspace, owner: String)? { kept }

  public func replace(with workspace: Workspace, owner: String) async throws {
    outbox.removeAll { $0.owner != owner }
    kept = (workspace, owner)
  }

  public func write(_ workspace: Workspace, changed: WorkspaceChanges) async throws {
    guard let owner = kept?.owner else { throw StoreError.noWorkspace }
    let pages = Set(workspace.pages.map { Array($0.id.utf8) })
    let tasks = Set(workspace.tasks.map { Array($0.id.utf8) })
    if let id = changed.upsertedPageIds.first(where: { !pages.contains(Array($0.utf8)) })
      ?? changed.upsertedTaskIds.first(where: { !tasks.contains(Array($0.utf8)) })
    {
      throw StoreError.notInWorkspace(id: id)
    }
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
    outbox[index].baseRevision = entry.baseRevision
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

  public func drafts() async throws -> [PageDraft] {
    draftsKept.values.sorted(by: PageDraft.inStoreOrder)
  }

  public func put(_ draft: PageDraft) async throws {
    draftsKept[DraftKey(owner: draft.owner, pageId: draft.pageId)] = draft
  }

  public func removeDraft(pageId: String, owner: String) async throws {
    draftsKept.removeValue(forKey: DraftKey(owner: owner, pageId: pageId))
  }

  public func eraseKeepingDrafts(except owner: String?) async throws {
    if let owner {
      let gone = Array(owner.utf8)
      draftsKept = draftsKept.filter { $0.key.owner != gone }
    }
    kept = nil
    outbox = []
    nextSeq = 1
  }
}
