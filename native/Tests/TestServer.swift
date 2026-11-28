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
    case saved(SaveOutcome)
  }

  private var script: [Reply]
  private var holding = false
  private var holdingSaves = false
  private var holdingCommands = false
  private var held: [CheckedContinuation<Void, Never>] = []
  private var arrivals: [CheckedContinuation<Void, Never>] = []
  /// The actions sent, in the order they were sent.
  private(set) var sent: [JSONValue] = []
  /// The operation id each action in `sent` was sent under, at the same index.
  private(set) var operationIds: [String] = []
  private(set) var unscripted = 0
  /// Workspace loads answered, with a reply or a failure.
  private(set) var loadsAnswered = 0
  /// The day drafts' answers, apart from the script, so a test that does not expect an ask is not thrown off by one.
  private var drafts: [Result<DayDraftReply, TransportError>] = []
  /// The dates day drafts were asked for, in the order asked.
  private(set) var draftDates: [LocalDate] = []
  private var holdingDrafts = false
  private var heldDrafts: [CheckedContinuation<Void, Never>] = []
  private var draftArrivals: [CheckedContinuation<Void, Never>] = []

  init(_ script: [Reply] = []) {
    self.script = script
  }

  func add(_ replies: [Reply]) {
    script += replies
  }

  /// Answers for the day drafts asked for next, in order.
  func addDrafts(_ answers: [Result<DayDraftReply, TransportError>]) {
    drafts += answers
  }

  /// Every call from now on, but a day draft's, waits for `release`.
  func hold() {
    holding = true
  }

  /// Every page save from now on waits for `release`; other calls are answered.
  func holdSaves() {
    holdingSaves = true
  }

  /// Every command sent from now on waits for `release`; page saves and other calls are answered.
  func holdCommands() {
    holdingCommands = true
  }

  /// The calls waiting to be released.
  var waitingCalls: Int { held.count }

  /// Lets every waiting call through, and stops holding.
  func release() {
    holding = false
    holdingSaves = false
    holdingCommands = false
    let waiting = held
    held = []
    for call in waiting { call.resume() }
  }

  /// Returns once a call is waiting to be released.
  func callHeld() async {
    if !held.isEmpty { return }
    await withCheckedContinuation { arrivals.append($0) }
  }

  /// Every day draft asked for from now on waits for `releaseDrafts`; `hold` and `release` do not touch them.
  func holdDrafts() {
    holdingDrafts = true
  }

  /// The day drafts waiting to be released.
  var waitingDrafts: Int { heldDrafts.count }

  /// Lets every waiting day draft through, and stops holding them.
  func releaseDrafts() {
    holdingDrafts = false
    let waiting = heldDrafts
    heldDrafts = []
    for ask in waiting { ask.resume() }
  }

  /// Lets the first waiting day draft through, and goes on holding the rest and the next.
  func releaseFirstDraft() {
    guard !heldDrafts.isEmpty else { return }
    heldDrafts.removeFirst().resume()
  }

  /// Returns once a day draft is waiting to be released.
  func draftHeld() async {
    if !heldDrafts.isEmpty { return }
    await withCheckedContinuation { draftArrivals.append($0) }
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
    defer { loadsAnswered += 1 }
    guard case .workspace(let reply) = try await answer() else { throw TransportError.unreadable }
    return reply
  }

  func send(
    token: String?, operationId: String, action: JSONValue, expectedOwner: String, basis: OutboxBasis
  ) async throws -> CommandOutcome {
    sent.append(action)
    operationIds.append(operationId)
    guard case .outcome(let outcome) = try await answer(isCommand: true) else { throw TransportError.unreadable }
    return outcome
  }

  func save(
    token: String?, operationId: String, expectedRevision: Int, expectedOwner: String, action: JSONValue
  ) async throws -> SaveOutcome {
    sent.append(action)
    operationIds.append(operationId)
    guard case .saved(let outcome) = try await answer(isSave: true) else { throw TransportError.unreadable }
    return outcome
  }

  /// With no answer queued it fails for lack of network, and is not counted as unscripted.
  func dayDraft(token: String?, date: LocalDate, operationId: String) async throws -> DayDraftReply {
    draftDates.append(date)
    if holdingDrafts {
      await withCheckedContinuation { ask in
        heldDrafts.append(ask)
        let waiting = draftArrivals
        draftArrivals = []
        for arrival in waiting { arrival.resume() }
      }
    }
    // Its answer is taken once released, so one queued while it was held is the one it gets.
    guard !drafts.isEmpty else { throw TransportError.offline }
    return try drafts.removeFirst().get()
  }

  private func answer(isSave: Bool = false, isCommand: Bool = false) async throws -> Reply {
    if holding || (isSave && holdingSaves) || (isCommand && holdingCommands) {
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

/// The memory store, except that `append` can be made to fail, and `replace` and `put` to wait for the test.
actor TestStore: WorkspaceStore {
  private let memory = MemoryWorkspaceStore()
  private var refusesAppend = false
  private var holdsReplace = false
  private var heldReplace: CheckedContinuation<Void, Never>?
  private var arrivals: [CheckedContinuation<Void, Never>] = []
  private var holdsPut = false
  private var heldPuts: [CheckedContinuation<Void, Never>] = []
  private var putArrivals: [CheckedContinuation<Void, Never>] = []
  /// The drafts stored, in the order stored.
  private(set) var puts: [PageDraft] = []

  struct Refused: Error {}

  func refuseAppend() { refusesAppend = true }

  /// The next `replace` waits for `releaseReplace`.
  func holdReplace() { holdsReplace = true }

  func releaseReplace() {
    holdsReplace = false
    heldReplace?.resume()
    heldReplace = nil
  }

  /// Every `put` from now on waits for `releasePut`.
  func holdPut() { holdsPut = true }

  /// Lets every waiting `put` through, and stops holding.
  func releasePut() {
    holdsPut = false
    let waiting = heldPuts
    heldPuts = []
    for call in waiting { call.resume() }
  }

  /// Lets the first waiting `put` through, and goes on holding the next.
  func releaseOnePut() {
    guard !heldPuts.isEmpty else { return }
    heldPuts.removeFirst().resume()
  }

  /// Returns once a `put` is waiting.
  func putHeld() async {
    if !heldPuts.isEmpty { return }
    await withCheckedContinuation { putArrivals.append($0) }
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
  func put(_ draft: PageDraft) async throws {
    if holdsPut {
      await withCheckedContinuation { call in
        heldPuts.append(call)
        let waiting = putArrivals
        putArrivals = []
        for arrival in waiting { arrival.resume() }
      }
    }
    puts.append(draft)
    try await memory.put(draft)
  }
  func removeDraft(pageId: String, owner: String) async throws {
    try await memory.removeDraft(pageId: pageId, owner: owner)
  }
  func eraseKeepingDrafts(except owner: String?) async throws {
    try await memory.eraseKeepingDrafts(except: owner)
  }
}
