import DaythreadCore
import Foundation

/// Keeps the copy on the device, the outbox and the server in step. The server is the authority: its replies replace
/// the copy the device keeps, and the copy holds nothing it did not send. What is drawn is that copy with the changes
/// not yet answered replayed over it (`drawn`), worked out again at each publish and never stored.
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
/// - **Commands waited for.** `perform` queues its command and asks for a pass; the pass sends it after its drain,
///   under the pass's epoch, and answers it. Every queued command is answered: by its pass, by the failure that ended
///   that pass, or with `signedOut` by the sign-in or sign-out that moved the epoch on. None is ever stored.
/// - **Trying again.** A pass that fails with an entry it could send still pending schedules another, after the
///   web's waits (`retryWaits`, or a 429's own wait when longer), through the injected `sleep`; the network coming back
///   cuts the wait short. A pass that ends well, a sign-in, a sign-out, or nothing left to send stops it.
/// - **The outbox in memory.** `outbox` is what the store's outbox holds, read again inside the same store section as
///   every write to it, so no published state has an entry in neither the outbox (drawn as a prediction) nor the
///   copy (applied by the server's answer).
public actor SyncEngine {
  let transport: any ServerTransport
  let tokens: any TokenStore
  let store: any WorkspaceStore
  let now: @Sendable () -> Date
  private let reachability: any Reachability
  private let sleep: @Sendable (Duration) async throws -> Void
  private let broadcast = StateBroadcast(.initial)

  // MARK: What is shown

  var phase: SyncState.Phase = .starting
  var offline = false
  var failure: SyncFailure?
  /// The stored owner's outbox entries by `seq`, as last read or written.
  var outbox: [OutboxEntry] = []
  /// Commands `perform` is waiting on, in the order asked.
  var performances: [Performance] = []
  /// Tickets given by `enqueue` in this engine's lifetime. Not an entry's `seq`, which restarts when the store is
  /// erased.
  private var enqueued = 0
  /// The account's email, as the server last told it; nil until it has on this launch.
  private var address: String?
  /// Whether a session is stored, as last read or written.
  private var signedIn = false
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
  /// The last request the running pass answers: those made before it asked the server for the workspace.
  private var covered = 0
  private var loadWanted = false
  var epoch = 0
  /// Sign-ins completed (their session kept), so a sign-out can tell that a newer sign-in happened while it waited for
  /// the server. A sign-in that fails does not count: the sign-out still erases.
  private var signIns = 0

  // MARK: Trying again

  /// The web's waits before trying again: 2 s, 5 s, 15 s, then 30 s each time.
  static let retryWaits: [Duration] = [.seconds(2), .seconds(5), .seconds(15), .seconds(30)]
  /// The wait in progress before the next try; nil when none is planned.
  private var retry: Task<Void, Never>?
  /// Which planned wait `retry` is, so a wait that ends after it was replaced asks for nothing.
  private var retryNumber = 0
  /// Passes that failed one after another with something left to send.
  private var failedPasses = 0
  private var listening: Task<Void, Never>?

  // MARK: Store sections

  private var busy = false
  private var waiting: [CheckedContinuation<Void, Never>] = []

  /// `sleep` is how the engine waits before trying again, and `reachability` says when the network is back; tests
  /// own both.
  public init(
    transport: any ServerTransport, tokens: any TokenStore, store: any WorkspaceStore,
    reachability: any Reachability = NoReachability(),
    sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
    now: @escaping @Sendable () -> Date = Date.init
  ) {
    self.transport = transport
    self.tokens = tokens
    self.store = store
    self.reachability = reachability
    self.sleep = sleep
    self.now = now
  }

  deinit {
    retry?.cancel()
    listening?.cancel()
  }

  /// The current state at once, then each change. Each read is a new stream; one whose reader stops is forgotten.
  public nonisolated var states: AsyncStream<SyncState> { broadcast.stream() }

  /// For tests: readers of `states` not yet forgotten, and passes asked for so far.
  nonisolated var subscriberCount: Int { broadcast.count }
  var passRequests: Int { requested }

  // MARK: Public calls

  /// The owner the Mac's server answers as when it runs with sign-in off.
  static let localOwner = "local"

  /// Shows the device's copy, then asks the server who the session is and loads the workspace.
  ///
  /// Whose copy may be shown before the server answers: the stored copy is published at once only when a stored
  /// session names the copy's owner, or when the copy is the Mac's (`local`) and there is no session. With a session
  /// for another owner nothing is shown until the load replaces the copy. With no session over a copy that is not
  /// `local` (left by a session that expired, or by an erase that failed at sign-out), sign-in is shown at once,
  /// without any request, and the copy and its outbox stay on disk, hidden: the same owner signing in gets them back
  /// (the outbox is sent with its operation ids), another owner signing in erases them first. Nothing is erased here.
  public func start() async {
    await acquire()
    await readCopyIfNeeded()
    await removeHeldDayRequests()
    signedIn = (try? tokens.read()) != nil
    var hidden = false
    if let copy, case .success(nil) = readSession(), copy.owner != Self.localOwner {
      hidden = true
      phase = .signedOut
      copyShown = false
      outbox = []
    }
    publish()
    release()
    if !hidden { await requestPass(load: true) }
  }

  /// Asks the server for the workspace, then sends what the outbox holds. For opening, returning to the app and
  /// pull to refresh.
  public func refresh() async {
    await requestPass(load: true)
  }

  /// Stores the entry, publishes a state that draws it, asks for a pass without waiting for it, and returns the
  /// entry's ticket: by then a state with `enqueued` at or past it has been published. Throws `SyncError.notReady`
  /// when no workspace is shown (nothing can be changed before something is), and what the store threw when it
  /// refuses the entry; either way nothing was stored, no ticket is given and nothing is sent.
  @discardableResult
  public func enqueue(action: JSONValue, label: String) async throws -> Int {
    await acquire()
    do {
      guard copyShown, phase != .signedOut else { throw SyncError.notReady }
      outbox.append(try await append(action: action, label: label))
    } catch {
      release()
      throw error
    }
    enqueued += 1
    let ticket = enqueued
    publish()
    release()
    askForPass(load: false)
    return ticket
  }

  /// Returns when no pass is running or asked for. For tests and for sign-out.
  public func settled() async {
    while let driver { await driver.value }
  }

  /// Signs in, then loads. A session of another account than the stored copy's erases the copy and its outbox first;
  /// the same account's are kept and sent. The transport's errors are thrown unchanged. If the device cannot erase or
  /// keep the session after the server accepted it, it ends signed out with nothing shown and the token cleared, and
  /// that error is thrown: a new account is never signed in over another account's rows.
  public func signIn(email: String, password: String, timezone: String) async throws {
    let session = try await transport.signIn(email: email, password: password, timezone: timezone)
    await acquire()
    epoch += 1
    running?.cancel()
    stopRetrying()
    answerStalePerformances()
    do {
      await readCopyIfNeeded()
      // A copy that could not be read may still be someone else's, so nothing known erases too.
      if copy?.owner != session.owner {
        try await store.erase()
        copy = nil
        outbox = []
      }
      try tokens.write(session)
    } catch {
      SyncLog.logger.error("Sign-in could not be kept on the device: \(SyncLog.describe(error), privacy: .public)")
      try? tokens.clear()
      phase = .signedOut
      signedIn = false
      failure = nil
      copyShown = false
      outbox = []
      address = nil
      publish()
      release()
      throw error
    }
    signIns += 1
    SyncLog.logger.notice("Signed in")
    phase = .ready
    signedIn = true
    offline = false
    failure = nil
    copyShown = copy != nil
    // The sign-in reply names no email: the address he signed in with is the account's.
    address = email
    await readOutbox()
    publish()
    release()
    await requestPass(load: true)
  }

  /// Unless `discardingUnsent`, first tries one pass; then, when changes are still unsent (pending, waiting or held;
  /// the engine's own request for today's page is not his), signs nobody out and returns how many, so he can be asked.
  /// Otherwise tells the server, erases the copy, the outbox and the session whatever it answered (a shared device must
  /// not keep someone's notes), and returns 0. Discarding tries no pass: he has said yes, and sign-out does not wait
  /// for the network beyond telling the server. The last action wins: a sign-in that completes while the server is
  /// being told is kept.
  ///
  /// If `erase` throws, it is tried once more; if it still throws, this ends signed out anyway. The copy then stays on
  /// disk but hidden (`start` shows no copy without its session), and is erased at the next sign-in under another
  /// owner.
  @discardableResult
  public func signOut(discardingUnsent: Bool) async -> Int {
    if !discardingUnsent { await requestPass(load: false) }
    await acquire()
    let unsent = outbox.count { !$0.asksForADay }
    if !discardingUnsent, unsent > 0 {
      release()
      SyncLog.logger.notice("Sign-out waits for a yes: \(unsent, privacy: .public) changes not sent")
      return unsent
    }
    epoch += 1
    running?.cancel()
    stopRetrying()
    answerStalePerformances()
    let signInsBefore = signIns
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
    defer { release() }
    guard signIns == signInsBefore else {
      SyncLog.logger.notice("Sign-out superseded by a sign-in that completed meanwhile")
      return 0
    }
    epoch += 1
    running?.cancel()
    stopRetrying()
    var erased = (try? await store.erase()) != nil
    if !erased { erased = (try? await store.erase()) != nil }
    try? tokens.clear()
    let told = reachedServer.map { $0 ? "told" : "offline" } ?? "not told"
    SyncLog.logger.notice("Signed out; server \(told, privacy: .public); copy erased: \(erased, privacy: .public)")
    copy = nil
    copyRead = true
    copyShown = false
    phase = .signedOut
    signedIn = false
    failure = nil
    outbox = []
    address = nil
    if let reachedServer { offline = !reachedServer }
    publish()
    return 0
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
    let ticket = askForPass(load: load)
    while finished < ticket, let driver { await driver.value }
  }

  /// Asks for a pass that starts after this request, without waiting for it; returns the request's number.
  @discardableResult
  func askForPass(load: Bool) -> Int {
    requested += 1
    if load { loadWanted = true }
    if driver == nil { driver = Task { await self.drive() } }
    return requested
  }

  private func drive() async {
    while finished < requested {
      covered = requested
      let load = loadWanted
      loadWanted = false
      let pass = Task { await self.pass(load: load) }
      running = pass
      await pass.value
      running = nil
      finished = covered
    }
    driver = nil
  }

  /// The running pass is about to ask for the workspace, and everything it does comes after: every request made so far
  /// is answered by it. So a refresh asked while a launch checks the account does not run a second pass.
  private func coverRequestsSoFar(_ pass: Pass) {
    guard !Task.isCancelled, pass.epoch == epoch else { return }
    covered = requested
    loadWanted = false
  }

  private func pass(load: Bool) async {
    let pass = await begin()
    // With no session and sign-in shown, there is nothing to ask the server until he signs in.
    if phase == .signedOut, pass.session == nil {
      answerPerformances(of: pass, with: .signedOut)
      return
    }
    do {
      var load = load
      if phase != .ready {
        try await checkAccount(pass)
        guard phase == .ready else {
          answerPerformances(of: pass, with: .signedOut)
          stopRetrying()
          return
        }
        load = true
      }
      if load {
        coverRequestsSoFar(pass)
        try await loadWorkspace(pass, have: copy?.workspace.revision)
      }
      try await drain(pass)
      try await performQueued(pass)
      try await enter(pass)
      defer { release() }
      await readOutbox()
      stopRetrying()
      let held = outbox.count { $0.state == .held }
      SyncLog.logger.info(
        "Pass done: revision \(self.copy?.workspace.revision ?? -1, privacy: .public), held \(held, privacy: .public)")
      publish()
    } catch {
      await end(pass, after: error)
    }
  }

  private func begin() async -> Pass {
    await acquire()
    defer { release() }
    await readCopyIfNeeded()
    let session = try? tokens.read()
    signedIn = session != nil
    return Pass(epoch: epoch, session: session)
  }

  /// Keeps everything on a failure. Lack of network sets `offline`; a session the server no longer knows is cleared
  /// and sign-in is shown, with the copy and the outbox kept for the next sign-in to claim or erase; any other reason
  /// is kept in `failure` until the server next answers.
  private func end(_ pass: Pass, after error: any Error) async {
    answerPerformances(of: pass, with: Performed(error))
    if error is CancellationError || error is Superseded {
      SyncLog.logger.info("Pass dropped: \(SyncLog.describe(error), privacy: .public)")
      return
    }
    // A launch with no session meets a refusal by design; it is said once, at the default level.
    if case .signedOut? = error as? TransportError {
      SyncLog.logger.notice(
        "\(pass.session == nil ? "No session; sign-in shown" : "The server no longer knows the session; signed out", privacy: .public)")
    } else {
      SyncLog.logger.error("Pass failed: \(SyncLog.describe(error), privacy: .public)")
    }
    guard (try? await enter(pass)) != nil else { return }
    defer { release() }
    switch error as? TransportError {
    case .offline?:
      offline = true
    case .signedOut?:
      try? tokens.clear()
      phase = .signedOut
      signedIn = false
      failure = nil
      copyShown = false
      offline = false
      address = nil
    default:
      failure = SyncFailure(error)
    }
    await readOutbox()
    if phase != .signedOut, hasSendable {
      planRetry(after: error)
    } else {
      stopRetrying()
    }
    publish()
  }

  private func checkAccount(_ pass: Pass) async throws {
    let account = try await transport.account(token: pass.session?.token)
    try await enter(pass)
    defer { release() }
    offline = false
    failure = nil
    if pass.session == nil && account.signIn {
      SyncLog.logger.notice("No session; sign-in shown")
      phase = .signedOut
      copyShown = false
      address = nil
    } else {
      phase = .ready
      address = account.email
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
    failure = nil
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
    await readOutbox()
    publish()
    return true
  }

  // MARK: Trying again

  /// A pending entry not waiting behind a held one: something a pass could send.
  private var hasSendable: Bool {
    let behind = outbox.waiting
    return outbox.contains { $0.state == .pending && !behind.contains($0.seq) }
  }

  /// Plans the next try after the schedule's wait, or a 429's when longer, replacing any wait in progress.
  private func planRetry(after error: any Error) {
    var wait = Self.retryWaits[min(failedPasses, Self.retryWaits.count - 1)]
    if case .wait(let seconds)? = error as? TransportError, .seconds(seconds) > wait { wait = .seconds(seconds) }
    failedPasses += 1
    retry?.cancel()
    retryNumber += 1
    let number = retryNumber
    let sleep = sleep
    SyncLog.logger.info("Trying again in \(wait.components.seconds, privacy: .public) s")
    retry = Task { [weak self] in
      // A cancelled wait (signed out, the network back, nothing left to send) asks for nothing.
      guard (try? await sleep(wait)) != nil, !Task.isCancelled else { return }
      await self?.retryDue(number)
    }
    listenForTheNetwork()
  }

  private func retryDue(_ number: Int) {
    guard number == retryNumber, retry != nil else { return }
    retry = nil
    askForPass(load: false)
  }

  /// Stops the wait in progress, and starts the schedule again from its first wait.
  private func stopRetrying() {
    retry?.cancel()
    retry = nil
    failedPasses = 0
  }

  private func listenForTheNetwork() {
    guard listening == nil else { return }
    let returns = reachability.becameReachable
    listening = Task { [weak self] in
      for await _ in returns { await self?.networkReturned() }
    }
  }

  /// Cuts a planned wait short; with none planned there is nothing to send.
  private func networkReturned() {
    guard let retry else { return }
    retry.cancel()
    self.retry = nil
    SyncLog.logger.info("The network is back; trying again now")
    askForPass(load: false)
  }

  // MARK: Store sections

  func acquire() async {
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
      // See `start` for whose copy may be shown before the server answers.
      switch readSession() {
      case .success(let session?): copyShown = session.owner == copy.owner
      case .success(nil): copyShown = copy.owner == Self.localOwner
      case .failure: copyShown = false
      }
    }
    await readOutbox()
  }

  private func readSession() -> Result<Session?, any Error> {
    Result { try tokens.read() }
  }

  /// Reads the outbox again after a store call that may have changed it. Runs inside a store section. An outbox that
  /// cannot be read keeps what was last read.
  func readOutbox() async {
    guard let entries = try? await store.entries() else { return }
    outbox = entries
  }

  /// What is drawn: the copy with every pending entry's action replayed over it in `seq` order, including those this
  /// build cannot predict (they change nothing) and those waiting behind a held one. A held entry is not replayed, so
  /// the page shows what the server has.
  ///
  /// An entry can be replayed over a copy that already holds its change: after a store call fails between writing
  /// the copy and acknowledging the entry, and while a load-then-acknowledge has the load in the copy. That is
  /// invisible only while every predicted command is idempotent; a later slice that predicts one that is not must
  /// deal with it.
  var drawn: Workspace? {
    guard copyShown, let copy else { return nil }
    return outbox.lazy.filter { $0.state == .pending }.reduce(copy.workspace) { $0.predicting($1.action) }
  }

  /// Held, pending and waiting entries are said only while the copy they belong to is shown.
  func publish() {
    let shown = copyShown && copy != nil
    let behind = outbox.waiting
    let held = outbox.filter { $0.state == .held && !$0.asksForADay }.map(HeldChange.init)
    let pending = outbox.count { $0.state == .pending && !behind.contains($0.seq) }
    broadcast.publish(
      SyncState(
        phase: phase, workspace: drawn, offline: offline, held: shown ? held : [], pending: shown ? pending : 0,
        waiting: shown ? behind.count : 0, failure: failure, signedIn: signedIn, enqueued: enqueued,
        address: address))
  }
}
