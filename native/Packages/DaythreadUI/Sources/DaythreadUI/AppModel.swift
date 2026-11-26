import DaythreadCore
import DaythreadSync
import Foundation
import Observation
import os

/// Why a sign-in did not go through, in the cases the screen tells apart.
public enum SignInFailure: Equatable, Sendable {
  case wrong, unconfirmed, notInvited
  /// Too many tries; the seconds to wait.
  case wait(seconds: Int)
  case offline, unavailable

  init(_ error: any Error) {
    switch error as? TransportError {
    case .refused(status: 401, reason: "wrong"?)?: self = .wrong
    case .refused(status: 401, reason: "unconfirmed"?)?: self = .unconfirmed
    case .refused(status: 403, reason: "not-invited"?)?: self = .notInvited
    case .wait(let seconds)?: self = .wait(seconds: seconds)
    case .offline?: self = .offline
    default: self = .unavailable
    }
  }
}

/// What the screens draw from: the engine's latest state, followed for as long as the model lives, with the ticks this
/// model has made and the engine has not yet drawn replayed over it.
///
/// The record of a tick: the engine's answer cannot come in the frame of the tap, since it is an actor that writes to
/// disk first. So `tick` records the action and draws it at once, and the record goes only when the engine draws it
/// too: once `enqueue` has returned its ticket and a state with `enqueued` at or past that ticket has arrived, in
/// either order. A record whose entry the engine could not store goes at once. Every record goes when the account
/// changes, so nothing of one account is drawn under another.
@MainActor
@Observable
public final class AppModel {
  /// The engine's latest state; until its first arrives (it sends one as soon as it is asked), the state of an engine
  /// that has not started.
  public private(set) var state = SyncState()
  /// Pages whose document does not write back byte for byte (Debug builds only); nil when every page does.
  private(set) var roundTrip: RoundTrip?
  /// False when the device's store could not be opened and changes live in memory for this launch only.
  public let keepsChanges: Bool

  struct RoundTrip: Equatable {
    let failing: Int
    let total: Int
  }

  /// An action handed to the engine and not yet drawn by it; `ticket` once `enqueue` has returned it.
  private struct Record {
    let id: Int
    let action: JSONValue
    var ticket: Int?
  }

  /// In the order made, which is the order the engine is handed them.
  private var records: [Record] = []
  @ObservationIgnored private var nextRecord = 0
  /// When each to-do was last ticked, for the double-tap guard.
  @ObservationIgnored private var lastTicks: [String: Date] = [:]
  @ObservationIgnored private let engine: SyncEngine
  @ObservationIgnored private let now: () -> Date
  @ObservationIgnored private var following: Task<Void, Never>?
  @ObservationIgnored private var auditedRevision: Int?

  /// The web drops a second tap on the same to-do this soon after the first.
  private static let doubleTap: TimeInterval = 0.5

  public init(engine: SyncEngine, keepsChanges: Bool = true, now: @escaping () -> Date = Date.init) {
    self.engine = engine
    self.keepsChanges = keepsChanges
    self.now = now
  }

  isolated deinit {
    following?.cancel()
  }

  /// What screens draw: the engine's workspace with this model's not-yet-accepted actions replayed over it. Replaying
  /// one the engine already draws changes nothing a screen shows: it sets the same status again.
  public var workspace: Workspace? {
    records.reduce(state.workspace) { $0?.predicting($1.action) }
  }

  /// The account's day: today in the workspace's zone, or the device's before there is a workspace.
  public var today: LocalDate {
    LocalDate.today(in: state.workspace?.timezone ?? TimeZone.current.identifier, at: now())
  }

  /// Follows the engine's states, then shows the device's copy and asks the server. Calling it again does nothing.
  public func start() {
    guard following == nil else { return }
    let states = engine.states
    following = Task { [weak self] in
      for await state in states {
        guard let self else { return }
        self.receive(state)
      }
    }
    let engine = engine
    Task { await engine.start() }
  }

  /// Nil once signed in.
  public func signIn(email: String, password: String) async -> SignInFailure? {
    do {
      try await engine.signIn(email: email, password: password, timezone: TimeZone.current.identifier)
      forgetTicks()
      return nil
    } catch {
      return SignInFailure(error)
    }
  }

  public enum SignOutAnswer: Equatable, Sendable {
    case signedOut
    /// Nobody was signed out: this many changes are not sent yet, and he is asked before they are erased.
    case unsent(Int)
  }

  /// Without `discardingUnsent`, tries once to send what is waiting, and signs out only when nothing is left unsent.
  public func signOut(discardingUnsent: Bool) async -> SignOutAnswer {
    let unsent = await engine.signOut(discardingUnsent: discardingUnsent)
    guard unsent == 0 else { return .unsent(unsent) }
    forgetTicks()
    return .signedOut
  }

  public func refresh() async {
    await engine.refresh()
  }

  // MARK: Changes

  /// Works out the status from what is drawn, records the action, and hands it to the engine.
  /// Returns false when nothing was done: the to-do cannot be ticked, or the same to-do was tapped under 500 ms ago.
  @discardableResult
  public func tick(taskId: String) -> Bool {
    guard let drawn = workspace, let task = drawn.task(taskId) else { return false }
    let status: TodoTask.Status
    switch task.status {
    case .open: status = .done
    case .done: status = .open
    case .cancelled, .other: return false
    }
    let time = now()
    if let last = lastTicks[taskId], time.timeIntervalSince(last) < Self.doubleTap { return false }
    lastTicks[taskId] = time

    let action = Command.taskStatus(taskId: taskId, status: status, today: today)
    let label = ChangeLabel.text(for: action, in: drawn)
    let id = nextRecord
    nextRecord += 1
    records.append(Record(id: id, action: action))
    let engine = engine
    Task { [weak self] in
      // An account change between the tap and this turn dropped the record; its action is not that account's.
      guard self?.records.contains(where: { $0.id == id }) == true else { return }
      let ticket = try? await engine.enqueue(action: action, label: label)
      self?.accepted(id, ticket: ticket)
    }
    return true
  }

  public func keep(_ id: Int) async {
    await engine.keep(id)
  }

  public func discard(_ id: Int) async {
    await engine.discard(id)
  }

  /// Sends `action` and waits for the server; nothing is stored, so nothing is sent later.
  public func perform(_ action: JSONValue) async -> Performed {
    await engine.perform(action: action)
  }

  /// `enqueue` returned; a nil ticket means nothing was stored, and the circle goes back to what the copy has.
  private func accepted(_ id: Int, ticket: Int?) {
    guard let index = records.firstIndex(where: { $0.id == id }) else { return }
    guard let ticket else {
      records.remove(at: index)
      return
    }
    records[index].ticket = ticket
    dropDrawnRecords()
  }

  /// Drops the records the engine's latest state draws.
  private func dropDrawnRecords() {
    let enqueued = state.enqueued
    if records.contains(where: { $0.ticket.map { $0 <= enqueued } ?? false }) {
      records.removeAll { $0.ticket.map { $0 <= enqueued } ?? false }
    }
  }

  private func forgetTicks() {
    if !records.isEmpty { records = [] }
    lastTicks = [:]
  }

  private func receive(_ state: SyncState) {
    self.state = state
    if state.phase == .signedOut {
      forgetTicks()
    } else {
      dropDrawnRecords()
    }
    #if DEBUG
      if let workspace = state.workspace { audit(workspace) }
    #endif
  }

  // MARK: Audit

  private static let auditLog = Logger(subsystem: "app.daythread.Daythread", category: "audit")

  /// Checks each new revision once, off the main actor; a result that a newer revision overtook is dropped.
  private func audit(_ workspace: Workspace) {
    guard workspace.revision != auditedRevision else { return }
    auditedRevision = workspace.revision
    Task { [weak self] in
      let failing = await Self.pagesThatDoNotRoundTrip(workspace)
      let total = workspace.pages.count
      Self.auditLog.log(
        "Round trip at revision \(workspace.revision): \(failing.count) of \(total) pages fail \(failing.joined(separator: ", "), privacy: .public)"
      )
      guard let self, self.auditedRevision == workspace.revision else { return }
      self.roundTrip = failing.isEmpty ? nil : RoundTrip(failing: failing.count, total: total)
    }
  }

  @concurrent
  private nonisolated static func pagesThatDoNotRoundTrip(_ workspace: Workspace) async -> [String] {
    Audit.pagesThatDoNotRoundTrip(workspace)
  }
}
