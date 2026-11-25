import DaythreadCore
import Foundation

/// Keeps the copy on the device, the outbox and the server in step. The server is the authority: its replies replace
/// what the device holds, and nothing is shown that it did not send.
///
/// How calls that overlap are kept apart (every `await` is a point where another call can enter the actor):
/// - **One pass at a time.** Loading, draining and applying replies happen in a *pass*. `requestPass` counts the
///   request; a single driver task runs passes one after another while requests are outstanding, so requests that
///   arrive during a pass are folded into one follow-up pass, never dropped and never run beside it.
/// - **Store sections.** Every read-then-write of the store, the token or the published state runs between `acquire()`
///   and `release()`, an async lock held only across store calls, never across a request to the server. So
///   `enqueue`, `signIn` and `signOut` can write while a pass waits for the network, but never in the middle of a
///   pass's write, and a pass never sees half of theirs.
/// - **Epochs.** `signIn` and `signOut` move `epoch` on (and cancel the pass in flight) inside a store section. A pass
///   remembers the epoch and session it began with and checks the epoch at the start of each of its sections, so a
///   reply that arrives after the account changed is never applied, sent on or shown.
public actor SyncEngine {
  let transport: any ServerTransport
  let tokens: any TokenStore
  let store: any WorkspaceStore
  let now: @Sendable () -> Date
  private let broadcast = StateBroadcast(.initial)

  // MARK: What is shown

  var phase: SyncState.Phase = .starting
  var offline = false
  var held = 0
  /// What the store keeps, read once and then kept in step with every store call this engine makes.
  var copy: (workspace: Workspace, owner: String)?
  private var copyRead = false
  /// Whether `copy` may be shown: not while signed out, nor while it belongs to another account than the session's.
  var copyShown = false

  // MARK: One pass at a time

  private var driver: Task<Void, Never>?
  private var running: Task<Void, Never>?
  private var requested = 0
  private var finished = 0
  private var loadWanted = false
  var epoch = 0

  // MARK: Store sections

  private var busy = false
  private var waiting: [CheckedContinuation<Void, Never>] = []

  public init(
    transport: any ServerTransport, tokens: any TokenStore, store: any WorkspaceStore,
    now: @escaping @Sendable () -> Date = Date.init
  ) {
    self.transport = transport
    self.tokens = tokens
    self.store = store
    self.now = now
  }

  /// The current state at once, then each change. Each read is a new stream; one whose reader stops is forgotten.
  public nonisolated var states: AsyncStream<SyncState> { broadcast.stream() }

  /// For tests: readers of `states` not yet forgotten, and passes asked for so far.
  nonisolated var subscriberCount: Int { broadcast.count }
  var passRequests: Int { requested }

  // MARK: Public calls

  /// Shows the device's copy before any request, then asks the server who the session is and loads the workspace.
  public func start() async {
    await acquire()
    await readCopyIfNeeded()
    publish()
    release()
    await requestPass(load: true)
  }

  /// Asks the server for the workspace, then sends what the outbox holds. For opening, returning to the app and
  /// pull to refresh.
  public func refresh() async {
    await requestPass(load: true)
  }

  /// Writes the change to the outbox, then sends it. Does nothing when no workspace is shown: nothing can be changed
  /// before something is. If the store refuses the entry, the change is not sent, since nothing could replay it.
  public func enqueue(action: JSONValue, label: String) async {
    await acquire()
    var kept = false
    if copyShown, phase != .signedOut {
      kept = (try? await append(action: action, label: label)) != nil
    }
    release()
    if kept { await requestPass(load: false) }
  }

  /// Signs in, then loads. A session of another account than the stored copy's erases the copy and its outbox first;
  /// the same account's are kept and sent. The transport's errors are thrown unchanged.
  public func signIn(email: String, password: String, timezone: String) async throws {
    let session = try await transport.signIn(email: email, password: password, timezone: timezone)
    await acquire()
    epoch += 1
    running?.cancel()
    do {
      await readCopyIfNeeded()
      // A copy that could not be read may still be someone else's, so nothing known erases too.
      if copy?.owner != session.owner {
        try await store.erase()
        copy = nil
        held = 0
      }
      try tokens.write(session)
    } catch {
      publish()
      release()
      throw error
    }
    phase = .ready
    offline = false
    copyShown = copy != nil
    held = await heldCount()
    publish()
    release()
    await requestPass(load: true)
  }

  /// Tells the server, then erases the copy, the outbox and the session whatever it answered: a shared device must not
  /// keep someone's notes.
  public func signOut() async {
    await acquire()
    epoch += 1
    running?.cancel()
    let session = try? tokens.read()
    release()

    var reachedServer: Bool?
    if let session {
      do {
        try await transport.signOut(token: session.token)
        reachedServer = true
      } catch TransportError.offline {
        reachedServer = false
      } catch {}
    }

    await acquire()
    epoch += 1
    running?.cancel()
    try? await store.erase()
    try? tokens.clear()
    copy = nil
    copyRead = true
    copyShown = false
    phase = .signedOut
    held = 0
    if let reachedServer { offline = !reachedServer }
    publish()
    release()
  }

  // MARK: Passes

  /// What a pass began with: a reply is applied only while `epoch` is still this one.
  struct Pass: Sendable {
    let epoch: Int
    let session: Session?
  }

  /// The account changed while a pass waited; what it was doing is dropped.
  struct Superseded: Error {}

  /// Returns once a pass that started after this request has finished.
  private func requestPass(load: Bool) async {
    requested += 1
    let ticket = requested
    if load { loadWanted = true }
    if driver == nil { driver = Task { await self.drive() } }
    while finished < ticket, let driver { await driver.value }
  }

  private func drive() async {
    while finished < requested {
      let ticket = requested
      let load = loadWanted
      loadWanted = false
      let pass = Task { await self.pass(load: load) }
      running = pass
      await pass.value
      running = nil
      finished = ticket
    }
    driver = nil
  }

  private func pass(load: Bool) async {
    let pass = await begin()
    do {
      var load = load
      if phase != .ready {
        try await checkAccount(pass)
        guard phase == .ready else { return }
        load = true
      }
      if load { try await loadWorkspace(pass, have: copy?.workspace.revision) }
      try await drain(pass)
      try await enter(pass)
      defer { release() }
      held = await heldCount()
      publish()
    } catch {
      await end(pass, after: error)
    }
  }

  private func begin() async -> Pass {
    await acquire()
    defer { release() }
    await readCopyIfNeeded()
    return Pass(epoch: epoch, session: try? tokens.read())
  }

  /// Keeps everything on a failure. Only lack of network sets `offline`; a session the server no longer knows is
  /// cleared and sign-in is shown, with the copy and the outbox kept for the next sign-in to claim or erase.
  private func end(_ pass: Pass, after error: any Error) async {
    if error is CancellationError || error is Superseded { return }
    guard (try? await enter(pass)) != nil else { return }
    defer { release() }
    switch error as? TransportError {
    case .offline?:
      offline = true
    case .signedOut?:
      try? tokens.clear()
      phase = .signedOut
      copyShown = false
      offline = false
    default:
      break
    }
    held = await heldCount()
    publish()
  }

  private func checkAccount(_ pass: Pass) async throws {
    let account = try await transport.account(token: pass.session?.token)
    try await enter(pass)
    defer { release() }
    offline = false
    if pass.session == nil && account.signIn {
      phase = .signedOut
      copyShown = false
    } else {
      phase = .ready
    }
    publish()
  }

  /// Loads the workspace; a reply that cannot stand for the copy (unchanged, but under another owner or revision) is
  /// followed by one load of the whole workspace.
  func loadWorkspace(_ pass: Pass, have: Int?) async throws {
    var have = have
    while true {
      let reply = try await transport.workspace(token: pass.session?.token, have: have)
      let applied = try await apply(reply, pass)
      guard !applied, have != nil else { return }
      have = nil
    }
  }

  /// Whether the reply could be applied.
  private func apply(_ reply: WorkspaceReply, _ pass: Pass) async throws -> Bool {
    try await enter(pass)
    defer { release() }
    offline = false
    switch reply {
    case .unchanged(let revision, let owner):
      guard let copy, copy.owner == owner, copy.workspace.revision == revision else {
        publish()
        return false
      }
    case .full(let workspace, let owner):
      try await store.replace(with: workspace, owner: owner)
      copy = (workspace, owner)
    }
    copyShown = true
    await ensureToday()
    held = await heldCount()
    publish()
    return true
  }

  // MARK: Store sections

  private func acquire() async {
    guard busy else {
      busy = true
      return
    }
    // Ownership is handed over by `release`, so `busy` stays true.
    await withCheckedContinuation { waiting.append($0) }
  }

  func release() {
    if waiting.isEmpty {
      busy = false
    } else {
      waiting.removeFirst().resume()
    }
  }

  /// Acquires the store section for `pass`, unless the pass was cancelled or the account changed since it began.
  /// The caller releases it.
  func enter(_ pass: Pass) async throws {
    await acquire()
    do {
      try Task.checkCancellation()
      guard pass.epoch == epoch else { throw Superseded() }
    } catch {
      release()
      throw error
    }
  }

  private func readCopyIfNeeded() async {
    guard !copyRead else { return }
    copyRead = true
    // An unreadable copy shows nothing; the server's next reply replaces it.
    copy = try? await store.load()
    if let copy {
      // A copy is shown before the server answers only when no session names another account.
      switch Result(catching: { try tokens.read() }) {
      case .success(let session?): copyShown = session.owner == copy.owner
      case .success(nil): copyShown = true
      case .failure: copyShown = false
      }
    }
    held = await heldCount()
  }

  func heldCount() async -> Int {
    guard let entries = try? await store.entries() else { return held }
    return entries.count { $0.state == .held }
  }

  func publish() {
    broadcast.publish(
      SyncState(phase: phase, workspace: copyShown ? copy?.workspace : nil, offline: offline, held: held))
  }
}
