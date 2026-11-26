import DaythreadCore
import DaythreadSync
import Foundation

/// A server that answers from a script, one reply per call in the order the calls come. While held, every call waits
/// until the test releases it, so a test can act while a request is in flight without sleeping. A call the script has
/// no reply for fails for lack of network and is written down.
actor TestServer: ServerTransport {
  enum Reply: Sendable {
    case session(Session)
    case done
    case account(Account)
    case workspace(WorkspaceReply)
    case outcome(CommandOutcome)
  }

  private var script: [Reply]
  private var holding = false
  private var held: [CheckedContinuation<Void, Never>] = []
  private var arrivals: [CheckedContinuation<Void, Never>] = []
  /// The actions sent, in the order they were sent.
  private(set) var sent: [JSONValue] = []
  private(set) var unscripted = 0

  init(_ script: [Reply] = []) {
    self.script = script
  }

  func add(_ replies: [Reply]) {
    script += replies
  }

  /// Every call from now on waits for `release`.
  func hold() {
    holding = true
  }

  /// Lets every waiting call through, and stops holding.
  func release() {
    holding = false
    let waiting = held
    held = []
    for call in waiting { call.resume() }
  }

  /// Returns once a call is waiting to be released.
  func callHeld() async {
    if !held.isEmpty { return }
    await withCheckedContinuation { arrivals.append($0) }
  }

  // MARK: ServerTransport

  func signIn(email: String, password: String, timezone: String) async throws -> Session {
    guard case .session(let session) = try await answer() else { throw TransportError.unreadable }
    return session
  }

  func signOut(token: String) async throws {
    guard case .done = try await answer() else { throw TransportError.unreadable }
  }

  func account(token: String?) async throws -> Account {
    guard case .account(let account) = try await answer() else { throw TransportError.unreadable }
    return account
  }

  func workspace(token: String?, have: Int?) async throws -> WorkspaceReply {
    guard case .workspace(let reply) = try await answer() else { throw TransportError.unreadable }
    return reply
  }

  func send(
    token: String?, operationId: String, action: JSONValue, expectedOwner: String, basis: OutboxBasis
  ) async throws -> CommandOutcome {
    sent.append(action)
    guard case .outcome(let outcome) = try await answer() else { throw TransportError.unreadable }
    return outcome
  }

  private func answer() async throws -> Reply {
    if holding {
      await withCheckedContinuation { call in
        held.append(call)
        let waiting = arrivals
        arrivals = []
        for arrival in waiting { arrival.resume() }
      }
    }
    guard !script.isEmpty else {
      unscripted += 1
      throw TransportError.offline
    }
    return script.removeFirst()
  }
}

/// The memory store, except that `append` can be made to fail and `replace` to wait for the test.
actor TestStore: WorkspaceStore {
  private let memory = MemoryWorkspaceStore()
  private var refusesAppend = false
  private var holdsReplace = false
  private var heldReplace: CheckedContinuation<Void, Never>?
  private var arrivals: [CheckedContinuation<Void, Never>] = []

  struct Refused: Error {}

  func refuseAppend() { refusesAppend = true }

  /// The next `replace` waits for `releaseReplace`.
  func holdReplace() { holdsReplace = true }

  func releaseReplace() {
    holdsReplace = false
    heldReplace?.resume()
    heldReplace = nil
  }

  /// Returns once a `replace` is waiting.
  func replaceHeld() async {
    if heldReplace != nil { return }
    await withCheckedContinuation { arrivals.append($0) }
  }

  func load() async throws -> (workspace: Workspace, owner: String)? { try await memory.load() }

  func replace(with workspace: Workspace, owner: String) async throws {
    if holdsReplace {
      await withCheckedContinuation { call in
        heldReplace = call
        let waiting = arrivals
        arrivals = []
        for arrival in waiting { arrival.resume() }
      }
    }
    try await memory.replace(with: workspace, owner: owner)
  }

  func write(_ workspace: Workspace, changed: WorkspaceChanges) async throws {
    try await memory.write(workspace, changed: changed)
  }

  func entries() async throws -> [OutboxEntry] { try await memory.entries() }

  func append(_ entry: NewOutboxEntry) async throws -> OutboxEntry {
    if refusesAppend { throw Refused() }
    return try await memory.append(entry)
  }

  func update(_ entry: OutboxEntry) async throws { try await memory.update(entry) }
  func remove(seq: Int) async throws { try await memory.remove(seq: seq) }
  func acknowledge(seq: Int, revision: Int?) async throws { try await memory.acknowledge(seq: seq, revision: revision) }
  func drafts() async throws -> [PageDraft] { try await memory.drafts() }
  func put(_ draft: PageDraft) async throws { try await memory.put(draft) }
  func removeDraft(pageId: String, owner: String) async throws {
    try await memory.removeDraft(pageId: pageId, owner: owner)
  }
  func erase() async throws { try await memory.erase() }
}
