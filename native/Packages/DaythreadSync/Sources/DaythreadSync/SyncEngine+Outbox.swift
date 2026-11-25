import DaythreadCore
import Foundation

/// The outbox: writing entries, sending them in `seq` order and acting on the server's outcome.
extension SyncEngine {
  /// What the drain does after an outcome.
  private enum Next {
    case send
    /// The entry is acknowledged; the workspace is loaded whole, then the drain goes on.
    case loadWhole
    /// The changes start from another revision than the copy's: load whole, then acknowledge the entry.
    case loadWholeThenAcknowledge(revision: Int)
    /// The reply is another account's: nothing more of this owner's is sent; the new owner's workspace is loaded.
    case loadWholeAndStop
  }

  /// Sends pending entries one at a time, oldest first, until none is left. Held entries are passed over.
  func drain(_ pass: Pass) async throws {
    while let entry = try await nextPending(pass) {
      // Every send states the entry's own basis; `readsBeyond` is stated conservatively until a command's reads are
      // ported (design, outbox §5 and §6).
      let basis = OutboxBasis(baseRevision: entry.baseRevision, ownRevisions: entry.ownRevisions, readsBeyond: true)
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
      case .loadWhole:
        try await loadWorkspace(pass, have: nil)
      case .loadWholeThenAcknowledge(let revision):
        try await loadWorkspace(pass, have: nil)
        try await enter(pass)
        defer { release() }
        // After a load under another owner, the entries left are that owner's; this revision is not theirs.
        try await store.acknowledge(seq: entry.seq, revision: copy?.owner == entry.owner ? revision : nil)
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
    var kept = entry
    kept.state = .held
    kept.reason = reason
    try await store.update(kept)
    held = await heldCount()
    publish()
  }

  private func nextPending(_ pass: Pass) async throws -> OutboxEntry? {
    try await enter(pass)
    defer { release() }
    return try await store.entries().first { $0.state == .pending }
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
      try await store.acknowledge(seq: entry.seq, revision: nil)
      held = await heldCount()
      publish()
      return .loadWhole
    case .held(let reason, _, _, _), .refused(let reason, _):
      var kept = entry
      kept.state = .held
      kept.reason = reason
      try await store.update(kept)
    case .ownerMismatch:
      publish()
      return .loadWholeAndStop
    }
    held = await heldCount()
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

  /// When the account's today has no day page, asks for one, unless the outbox already holds that request. A store
  /// that refuses is asked again after the next load. Runs inside a store section.
  func ensureToday() async {
    guard let copy else { return }
    // `today` would read an unknown zone as GMT, and ask for another day than the account's.
    guard LocalDate.isKnown(timezone: copy.workspace.timezone) else {
      SyncLog.logger.error(
        "The workspace's time zone is not one this device knows; no day page is asked for: \(copy.workspace.timezone, privacy: .public)")
      return
    }
    let today = LocalDate.today(in: copy.workspace.timezone, at: now())
    guard copy.workspace.dayPage(today) == nil, let entries = try? await store.entries() else { return }
    let asked = entries.contains { entry in
      let action = entry.action.objectValue
      return action?["type"]?.stringValue == "ensure-day" && action?["date"]?.stringValue == today.value
    }
    guard !asked else { return }
    let action: JSONValue = .object(["type": .string("ensure-day"), "date": .string(today.value)])
    _ = try? await append(action: action, label: "Open today's page")
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
