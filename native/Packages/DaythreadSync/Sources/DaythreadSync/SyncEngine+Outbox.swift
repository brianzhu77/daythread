import DaythreadCore
import Foundation

/// The outbox: writing entries, sending them in `seq` order and acting on the server's outcome.
extension SyncEngine {
  /// What the drain does after an outcome.
  private enum Next {
    case send
    /// The copy lacks what the server did for the entry (its changes start from another revision than the copy's, or
    /// it was applied before and its answer lost): load whole, then acknowledge the entry, learning `revision` when
    /// given. The entry stays pending until then, so it is drawn until the load is in the copy, and a load that fails
    /// leaves it to be sent again.
    case loadWholeThenAcknowledge(revision: Int?)
    /// The reply is another account's: nothing more of this owner's is sent; the new owner's workspace is loaded.
    case loadWholeAndStop
  }

  /// Sends pending entries one at a time, oldest first, until none is left. Held entries are passed over, and so are
  /// those waiting behind one.
  func drain(_ pass: Pass) async throws {
    while let entry = try await nextPending(pass) {
      let basis = OutboxBasis(
        baseRevision: entry.baseRevision, ownRevisions: entry.ownRevisions,
        readsBeyond: Command.readsBeyond(entry.action))
      let outcome: CommandOutcome
      do {
        outcome = try await transport.send(
          token: pass.session?.token, operationId: entry.operationId, action: entry.action,
          expectedOwner: entry.owner, basis: basis)
      } catch TransportError.refused(status: 400, reason: _) {
        // The server will never accept this body: retrying it would block every entry behind it.
        try await hold(entry, reason: "bad-request", pass)
        continue
      }
      switch try await settle(outcome, of: entry, pass) {
      case .send:
        continue
      case .loadWholeThenAcknowledge(let revision):
        try await loadWorkspace(pass, have: nil)
        try await enter(pass)
        defer { release() }
        // After a load under another owner, the entries left are that owner's; this revision is not theirs.
        try await store.acknowledge(seq: entry.seq, revision: copy?.owner == entry.owner ? revision : nil)
        await readOutbox()
      case .loadWholeAndStop:
        try await loadWorkspace(pass, have: nil)
        return
      }
    }
  }

  /// Holds `entry` for him, as the server's `held` outcome would.
  private func hold(_ entry: OutboxEntry, reason: String, _ pass: Pass) async throws {
    try await enter(pass)
    defer { release() }
    offline = false
    failure = nil
    SyncLog.logger.notice("Outbox \(entry.operationId, privacy: .public): \(reason, privacy: .public), held")
    try await keepHeld(entry, reason: reason)
    await readOutbox()
    publish()
  }

  /// Keeps `entry` as held for `reason`, the server's words. The engine's own request for today's page is removed
  /// instead, as the web removes its own writes: he never asked for it, and the next load asks again if today still
  /// has no page. Runs inside a store section.
  private func keepHeld(_ entry: OutboxEntry, reason: String) async throws {
    guard !entry.asksForADay else {
      try await store.remove(seq: entry.seq)
      return
    }
    var kept = entry
    kept.state = .held
    kept.reason = reason
    try await store.update(kept)
  }

  private func nextPending(_ pass: Pass) async throws -> OutboxEntry? {
    try await enter(pass)
    defer { release() }
    let entries = try await store.entries()
    let waiting = entries.waiting
    return entries.first { $0.state == .pending && !waiting.contains($0.seq) }
  }

  private func settle(_ outcome: CommandOutcome, of entry: OutboxEntry, _ pass: Pass) async throws -> Next {
    try await enter(pass)
    defer { release() }
    offline = false
    failure = nil
    SyncLog.logger.info("Outbox \(entry.operationId, privacy: .public): \(outcome.kind, privacy: .public)")
    // A reply under another owner than the copy's is never applied to it.
    guard let copy, outcome.owner == copy.owner else {
      publish()
      return .loadWholeAndStop
    }
    switch outcome {
    case .applied(_, let changes, _):
      guard let next = copy.workspace.applying(changes) else {
        publish()
        return .loadWholeThenAcknowledge(revision: changes.revision)
      }
      // Two transactions: a death between them leaves the entry pending, and its replay is answered with the
      // receipt the server kept and acknowledged then.
      try await store.write(next, changed: changes)
      self.copy = (next, copy.owner)
      try await store.acknowledge(seq: entry.seq, revision: changes.revision)
    case .alreadyApplied:
      publish()
      return .loadWholeThenAcknowledge(revision: nil)
    case .held(let reason, _, _, _), .refused(let reason, _):
      try await keepHeld(entry, reason: reason)
    case .ownerMismatch:
      publish()
      return .loadWholeAndStop
    }
    // The copy and the outbox have both moved on before this publish: the entry is drawn by one or the other.
    await readOutbox()
    publish()
    return .send
  }

  /// Writes an entry under the copy's owner, built on the copy's revision. Runs inside a store section.
  func append(action: JSONValue, label: String) async throws -> OutboxEntry {
    guard let copy else { throw SyncError.notReady }
    return try await store.append(
      NewOutboxEntry(
        kind: .command, owner: copy.owner, operationId: UUID().uuidString.lowercased(), action: action,
        baseRevision: copy.workspace.revision, ownRevisions: [], label: label, createdAt: now(), state: .pending,
        reason: nil))
  }

  /// When the account's today has no day page, live or in Trash, asks for one, unless the outbox already holds that
  /// request. A page in Trash is his to restore or start again. A store that refuses is asked again after the next
  /// load. Runs inside a store section.
  func ensureToday() async {
    guard let copy else { return }
    // `today` would read an unknown zone as GMT, and ask for another day than the account's.
    guard LocalDate.isKnown(timezone: copy.workspace.timezone) else {
      SyncLog.logger.error(
        "The workspace's time zone is not one this device knows; no day page is asked for: \(copy.workspace.timezone, privacy: .public)")
      return
    }
    let today = LocalDate.today(in: copy.workspace.timezone, at: now())
    guard copy.workspace.dayPage(today) == nil, copy.workspace.trashedDayPage(today) == nil,
      let entries = try? await store.entries()
    else { return }
    let asked = entries.contains { entry in
      let action = entry.action.objectValue
      return action?["type"]?.stringValue == "ensure-day" && action?["date"]?.stringValue == today.value
    }
    guard !asked else { return }
    _ = try? await append(action: Command.ensureDay(today), label: "Open today's page")
  }

  /// Removes the held requests for a day page a store keeps from an earlier build, which held them. Runs inside a
  /// store section.
  func removeHeldDayRequests() async {
    guard let entries = try? await store.entries() else { return }
    let left = entries.filter { $0.state == .held && $0.asksForADay }
    guard !left.isEmpty else { return }
    for entry in left { try? await store.remove(seq: entry.seq) }
    await readOutbox()
  }

  // MARK: Held changes

  /// Puts a held change back as pending, built on the copy's revision with no revisions of its own, as the web's
  /// Keep mine does, and asks for a pass. The operation id stays. Does nothing for a change that cannot be kept, or
  /// that is no longer held.
  public func keep(_ id: Int) async {
    await acquire()
    defer { release() }
    guard copyShown, phase != .signedOut, let copy,
      var entry = outbox.first(where: { $0.seq == id && $0.state == .held }), HeldChange(entry).canKeep
    else { return }
    entry.state = .pending
    entry.reason = nil
    entry.baseRevision = copy.workspace.revision
    entry.ownRevisions = []
    do {
      try await store.update(entry)
    } catch {
      SyncLog.logger.error("A held change could not be kept: \(SyncLog.describe(error), privacy: .public)")
      return
    }
    await readOutbox()
    publish()
    askForPass(load: false)
  }

  /// Removes a held change, and asks for a pass so the changes waiting behind it go.
  public func discard(_ id: Int) async {
    await acquire()
    defer { release() }
    guard copyShown, phase != .signedOut, outbox.contains(where: { $0.seq == id && $0.state == .held }) else { return }
    do {
      try await store.remove(seq: id)
    } catch {
      SyncLog.logger.error("A held change could not be discarded: \(SyncLog.describe(error), privacy: .public)")
      return
    }
    await readOutbox()
    publish()
    askForPass(load: false)
  }

  // MARK: Commands waited for

  /// A command `perform` waits on: who it was made for, and in which epoch.
  struct Performance: Sendable {
    let action: JSONValue
    let owner: String
    let epoch: Int
    let answer: CheckedContinuation<Performed, Never>
  }

  /// Sends `action` once, after everything pending, on the copy's revision, `readsBeyond: true`, and returns what the
  /// server did. Never stored, so a command sent as the network drops is not sent again later. On `.applied` the
  /// reply's changes are in the published workspace before it returns.
  public func perform(action: JSONValue) async -> Performed {
    await acquire()
    guard phase != .signedOut else {
      release()
      return .signedOut
    }
    // Before the first load there is no copy to build it on, and the server has not been reached.
    guard copyShown, let owner = copy?.owner else {
      release()
      return .offline
    }
    return await withCheckedContinuation { answer in
      performances.append(Performance(action: action, owner: owner, epoch: epoch, answer: answer))
      release()
      askForPass(load: false)
    }
  }

  /// Sends the queued commands one at a time; each is answered before the next is taken.
  func performQueued(_ pass: Pass) async throws {
    while true {
      try await enter(pass)
      guard !performances.isEmpty else {
        release()
        return
      }
      let performance = performances.removeFirst()
      let revision = copy?.workspace.revision
      release()
      guard performance.epoch == pass.epoch, let revision else {
        performance.answer.resume(returning: .signedOut)
        continue
      }
      let step: PerformStep
      do {
        step = try await send(performance, on: revision, pass)
      } catch {
        performance.answer.resume(returning: Performed(error))
        throw error
      }
      switch step {
      case .answer(let performed):
        performance.answer.resume(returning: performed)
      case .loadWholeThenAnswer(let performed):
        do {
          try await loadWorkspace(pass, have: nil)
        } catch {
          // The server's answer stands; only the copy is behind, and the pass's failure says so.
          performance.answer.resume(returning: performed)
          throw error
        }
        performance.answer.resume(returning: performed)
      }
    }
  }

  private enum PerformStep {
    case answer(Performed)
    /// The copy lacks what the server did, or the reply is another account's: the answer is given once the whole
    /// workspace is loaded.
    case loadWholeThenAnswer(Performed)
  }

  private func send(_ performance: Performance, on revision: Int, _ pass: Pass) async throws -> PerformStep {
    let outcome: CommandOutcome
    do {
      outcome = try await transport.send(
        token: pass.session?.token, operationId: UUID().uuidString.lowercased(), action: performance.action,
        expectedOwner: performance.owner,
        basis: OutboxBasis(baseRevision: revision, ownRevisions: [], readsBeyond: true))
    } catch TransportError.refused(status: 400, reason: _) {
      return .answer(.refused("bad-request"))
    }
    try await enter(pass)
    defer { release() }
    offline = false
    failure = nil
    SyncLog.logger.info("Performed: \(outcome.kind, privacy: .public)")
    guard let copy, outcome.owner == copy.owner else {
      publish()
      return .loadWholeThenAnswer(.refused("owner-mismatch"))
    }
    switch outcome {
    case .applied(_, let changes, _):
      guard let next = copy.workspace.applying(changes) else {
        publish()
        return .loadWholeThenAnswer(.applied)
      }
      try await store.write(next, changed: changes)
      self.copy = (next, copy.owner)
      await readOutbox()
      publish()
      return .answer(.applied)
    case .alreadyApplied:
      // Not expected for an operation id never sent before; the copy is loaded whole to be sure of it.
      publish()
      return .loadWholeThenAnswer(.applied)
    case .held(let reason, _, _, _), .refused(let reason, _):
      publish()
      return .answer(.refused(reason))
    case .ownerMismatch:
      publish()
      return .loadWholeThenAnswer(.refused("owner-mismatch"))
    }
  }

  /// Answers the queued commands of `pass`'s epoch, or older, with `performed`, when the pass ends without sending
  /// them.
  func answerPerformances(of pass: Pass, with performed: Performed) {
    let (ended, left) = performances.partitioned { $0.epoch <= pass.epoch }
    performances = left
    for performance in ended { performance.answer.resume(returning: performed) }
  }

  /// Answers every queued command made before the account changed. Called just after `epoch` moves on.
  func answerStalePerformances() {
    let (stale, left) = performances.partitioned { $0.epoch < epoch }
    performances = left
    for performance in stale { performance.answer.resume(returning: .signedOut) }
  }
}

extension Performed {
  /// What a command that got no answer reads as.
  init(_ error: any Error) {
    switch error {
    case TransportError.offline: self = .offline
    case TransportError.signedOut, is CancellationError, is SyncEngine.Superseded: self = .signedOut
    case TransportError.server, TransportError.wait, TransportError.unreadable: self = .offline
    case TransportError.refused(_, let reason): self = .refused(reason ?? "refused")
    default: self = .offline
    }
  }
}

extension Array {
  /// The elements that satisfy `belongs`, and the rest, each in order.
  fileprivate func partitioned(by belongs: (Element) -> Bool) -> ([Element], [Element]) {
    var matching: [Element] = []
    var rest: [Element] = []
    for element in self {
      if belongs(element) { matching.append(element) } else { rest.append(element) }
    }
    return (matching, rest)
  }
}

extension CommandOutcome {
  /// The outcome's name, for the log: never its message, rows or changes.
  fileprivate var kind: String {
    switch self {
    case .applied: "applied"
    case .held: "held"
    case .alreadyApplied: "already-applied"
    case .refused: "refused"
    case .ownerMismatch: "owner-mismatch"
    }
  }

  /// The account the server answered as.
  fileprivate var owner: String {
    switch self {
    case .applied(_, _, let owner), .held(_, _, _, let owner), .alreadyApplied(let owner), .refused(_, let owner),
      .ownerMismatch(let owner):
      owner
    }
  }
}
