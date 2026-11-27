import DaythreadCore
import Foundation

/// The outbox: writing entries, sending them in `seq` order and acting on the server's outcome.
extension SyncEngine {
  /// What the drain does after an outcome.
  private enum Next {
    case send
    /// The server held or refused one of his entries: the copy is behind what it checked the entry against. The
    /// drain goes on, and loads once before the pass does anything else.
    case sendThenLoad
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
  ///
  /// When the server held or refused one of his entries, the workspace is loaded once, so the page shows what the
  /// server has, a held tick is settled against it (`settleHeldTicks`) and Keep mine is built on it; then what that
  /// load sent again or asked for (today's page) is sent, with no second load whatever its answer, so a pass never
  /// loops between holding and loading. A tick held after that load is settled by the next pass's. Returns whether it
  /// loaded.
  @discardableResult
  func drain(_ pass: Pass) async throws -> Bool {
    guard try await sendPending(pass) == .copyBehind else { return false }
    let owner = copy?.owner
    try await loadWorkspace(pass, have: copy?.workspace.revision)
    // A load under another owner leaves nothing of this owner's to send in this pass.
    guard copy?.owner == owner else { return true }
    _ = try await sendPending(pass)
    if !unsettled.isEmpty { askForPass(load: true) }
    return true
  }

  private enum Drained {
    case done
    /// An entry was held or refused and no load since has brought the copy up to date.
    case copyBehind
    /// The reply was another account's and the workspace was loaded whole under it.
    case stopped
  }

  private func sendPending(_ pass: Pass) async throws -> Drained {
    var behind = false
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
      case .sendThenLoad:
        behind = true
      case .loadWholeThenAcknowledge(let revision):
        try await loadWorkspace(pass, have: nil)
        // That load brought the copy up to what the server has, holds included.
        behind = false
        try await enter(pass)
        defer { release() }
        // After a load under another owner, the entries left are that owner's; this revision is not theirs.
        try await store.acknowledge(seq: entry.seq, revision: copy?.owner == entry.owner ? revision : nil)
        await readOutbox()
        // The load holds its change now: said at once, not replayed until the pass's next publish.
        publish()
      case .loadWholeAndStop:
        try await loadWorkspace(pass, have: nil)
        return .stopped
      }
    }
    return behind ? .copyBehind : .done
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

  // MARK: Merging a held tick

  /// Whether a hold of `entry` is settled by the app rather than asked about: a tick or an untick the server held
  /// because its row changed, not one already sent again after a merge. An action to `cancelled` is not merged.
  private func canMerge(_ entry: OutboxEntry, heldFor reason: String) -> Bool {
    guard ["conflict", "changed-since", "maybe-applied"].contains(reason), !merged.contains(entry.operationId),
      let wanted = entry.wantedStatus
    else { return false }
    return wanted == .done || wanted == .open
  }

  /// Settles each held tick in `unsettled` against the copy just loaded: dropped when the to-do already has the status
  /// he asked for; sent again on the copy's revision with no revisions of its own (Keep mine, unasked) when it still
  /// has the status he tapped it from, so his status and the other change both stand; held for him when the to-do has
  /// any other status or is gone. A tick the server says may already be applied is only ever dropped or held: its
  /// tapped-from status may be another device undoing it after it went in, and sending it again would reverse that.
  /// Runs inside a store section, before the load is published.
  func settleHeldTicks() async throws {
    guard !unsettled.isEmpty else { return }
    let reasons = unsettled
    unsettled = [:]
    guard let copy else { return }
    for entry in try await store.entries() where entry.state == .pending {
      guard let reason = reasons[entry.operationId], let taskId = Command.taskId(of: entry.action),
        let wanted = entry.wantedStatus
      else { continue }
      // Ids compare by code units, as they do in the domain.
      let task = copy.workspace.tasks.first { $0.id.utf8.elementsEqual(taskId.utf8) }
      if task == nil, reason != "maybe-applied" {
        // The app's own word, read as gone; everywhere else the reason field holds the server's.
        try await keepHeld(entry, reason: "gone")
        continue
      }
      let tappedFrom: TodoTask.Status = wanted == .done ? .open : .done
      if task?.status == wanted {
        SyncLog.logger.notice("Outbox \(entry.operationId, privacy: .public): the server has it already, dropped")
        try await store.remove(seq: entry.seq)
      } else if task?.status == tappedFrom, reason != "maybe-applied" {
        SyncLog.logger.notice("Outbox \(entry.operationId, privacy: .public): merged, sent again")
        var again = entry
        again.baseRevision = copy.workspace.revision
        again.ownRevisions = []
        try await store.update(again)
        merged.insert(entry.operationId)
      } else {
        SyncLog.logger.notice("Outbox \(entry.operationId, privacy: .public): \(reason, privacy: .public), held")
        try await keepHeld(entry, reason: reason)
      }
    }
  }

  private func nextPending(_ pass: Pass) async throws -> OutboxEntry? {
    try await enter(pass)
    defer { release() }
    let entries = try await store.entries()
    let waiting = entries.waiting(behind: Set(unsettled.keys)).union(waitingForDrafts(entries))
    return entries.first { $0.state == .pending && unsettled[$0.operationId] == nil && !waiting.contains($0.seq) }
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
    var next = Next.send
    switch outcome {
    case .applied(_, let changes, _):
      guard let updated = copy.workspace.applying(changes) else {
        publish()
        return .loadWholeThenAcknowledge(revision: changes.revision)
      }
      // Two transactions: a death between them leaves the entry pending, and its replay is answered with the
      // receipt the server kept and acknowledged then.
      try await store.write(updated, changed: changes)
      self.copy = (updated, copy.owner)
      forgetOverwrittenSaves()
      try await store.acknowledge(seq: entry.seq, revision: changes.revision)
    case .alreadyApplied:
      publish()
      return .loadWholeThenAcknowledge(revision: nil)
    case .held(let reason, _, _, _) where canMerge(entry, heldFor: reason):
      // Left pending, so the tick stays drawn, until the load that follows settles it.
      unsettled[entry.operationId] = reason
      next = .sendThenLoad
    case .held(let reason, _, _, _), .refused(let reason, _):
      try await keepHeld(entry, reason: reason)
      // The engine's own request for today's page is removed, and a load would only ask for it again.
      if !entry.asksForADay { next = .sendThenLoad }
    case .ownerMismatch:
      publish()
      return .loadWholeAndStop
    }
    // The copy and the outbox have both moved on before this publish: the entry is drawn by one or the other.
    await readOutbox()
    publish()
    return next
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

  /// Sends `action` after everything pending, on the copy's revision, `readsBeyond: true`, and returns what the
  /// server did. When the server holds it because the copy is behind, the workspace is loaded and it is sent once
  /// more, under the same operation id; any other hold or refusal is answered after a load. Never stored, so a command
  /// sent as the network drops is not sent again later. On `.applied` the reply's changes are in the published
  /// workspace before it returns, except when the server's changes did not start from the copy's revision and the
  /// whole load that follows fails: the server applied it, and the copy catches up at the next load.
  public func perform(action: JSONValue) async -> Performed {
    await acquire()
    guard phase != .signedOut, !leaving else {
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
      release()
      guard performance.epoch == pass.epoch else {
        performance.answer.resume(returning: .signedOut)
        continue
      }
      try await answer(performance, pass)
    }
  }

  /// Sends `performance`, sends it once more when the server held it only because the copy was behind, and answers
  /// it. Every hold or refusal is followed by a load before the answer, so a second tap is built on what the server
  /// has, as the web resyncs before a retry. Throws, with the command answered, when the pass cannot go on.
  ///
  /// The command has left the queue, so nothing else can answer it: every throw below answers it first, exactly once.
  private func answer(_ performance: Performance, _ pass: Pass) async throws {
    // One operation for both sends: a held command wrote nothing on the server, so it has no receipt to replay.
    let operationId = UUID().uuidString.lowercased()
    var sentAgain = false
    while true {
      do {
        try await enter(pass)
      } catch {
        // A sign-out or sign-in took the section first, or the pass was cancelled.
        performance.answer.resume(returning: interrupted(error, pass) ?? Performed(error))
        throw error
      }
      let revision = copy?.workspace.revision
      release()
      guard let revision else {
        performance.answer.resume(returning: .signedOut)
        return
      }
      let step: PerformStep
      do {
        step = try await send(performance, operationId: operationId, on: revision, pass)
      } catch {
        performance.answer.resume(returning: interrupted(error, pass) ?? Performed(error))
        throw error
      }
      let performed: Performed
      let have: Int?
      switch step {
      case .answer(let answered):
        performance.answer.resume(returning: answered)
        return
      case .loadWholeThenAnswer(let answered):
        (performed, have) = (answered, nil)
      case .loadThenAnswer(let answered):
        (performed, have) = (answered, revision)
      case .loadThenSendAgain(let answered):
        (performed, have) = (answered, revision)
      }
      do {
        try await loadWorkspace(pass, have: have)
      } catch {
        // The server's answer stands, only the copy is behind, and the pass's failure says so; unless the account
        // changed meanwhile, when the answer belongs to an account no longer shown.
        performance.answer.resume(returning: interrupted(error, pass) ?? performed)
        throw error
      }
      guard case .loadThenSendAgain = step, !sentAgain, copy?.owner == performance.owner else {
        performance.answer.resume(returning: performed)
        return
      }
      sentAgain = true
    }
  }

  /// What a command reads when its pass was cut off rather than answered: signed out when the account changed or a
  /// sign-out has begun since the pass began, offline when the pass was only cancelled. Nil for any other error.
  func interrupted(_ error: any Error, _ pass: Pass) -> Performed? {
    guard error is CancellationError || error is Superseded else { return nil }
    return pass.epoch != epoch || leaving ? .signedOut : .offline
  }

  private enum PerformStep {
    case answer(Performed)
    /// The copy lacks what the server did, or the reply is another account's: the answer is given once the whole
    /// workspace is loaded.
    case loadWholeThenAnswer(Performed)
    /// The server held or refused it: the copy may be behind, and is loaded before the answer.
    case loadThenAnswer(Performed)
    /// The server held it only because the copy is behind: loaded, then sent once more on the new revision.
    case loadThenSendAgain(Performed)
  }

  private func send(
    _ performance: Performance, operationId: String, on revision: Int, _ pass: Pass
  ) async throws -> PerformStep {
    let outcome: CommandOutcome
    do {
      outcome = try await transport.send(
        token: pass.session?.token, operationId: operationId, action: performance.action,
        expectedOwner: performance.owner,
        basis: OutboxBasis(baseRevision: revision, ownRevisions: [], readsBeyond: true))
    } catch TransportError.refused(let status, let reason) {
      // The server's answer to this command alone: answered, and the pass goes on to the next.
      return .answer(.refused(status == 400 ? "bad-request" : reason ?? "refused"))
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
      forgetOverwrittenSaves()
      await readOutbox()
      publish()
      return .answer(.applied)
    case .alreadyApplied:
      // Not expected for an operation id never sent before; the copy is loaded whole to be sure of it.
      publish()
      return .loadWholeThenAnswer(.applied)
    case .held(let reason, _, let stale, _):
      publish()
      // The server's `stale` says it may be built again on the latest state; `changed-since` is the copy behind.
      let behind = stale || reason == "changed-since"
      return behind ? .loadThenSendAgain(.refused(reason)) : .loadThenAnswer(.refused(reason))
    case .refused(let reason, _):
      publish()
      return .loadThenAnswer(.refused(reason))
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
