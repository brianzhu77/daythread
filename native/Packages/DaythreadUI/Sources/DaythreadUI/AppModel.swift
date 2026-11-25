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

/// What the screens draw from: the engine's latest state, followed for as long as the model lives.
@MainActor
@Observable
public final class AppModel {
  /// Nil only until the engine's first state arrives, which it sends as soon as it is asked.
  public private(set) var state: SyncState?
  /// The address that signed in on this launch; the engine does not publish one.
  private(set) var address: String?
  /// Pages whose document does not write back byte for byte (Debug builds only); nil when every page does.
  private(set) var roundTrip: RoundTrip?

  struct RoundTrip: Equatable {
    let failing: Int
    let total: Int
  }

  @ObservationIgnored private let engine: SyncEngine
  @ObservationIgnored private var following: Task<Void, Never>?
  @ObservationIgnored private var auditedRevision: Int?

  public init(engine: SyncEngine) {
    self.engine = engine
  }

  isolated deinit {
    following?.cancel()
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
      address = email.trimmingCharacters(in: .whitespacesAndNewlines)
      return nil
    } catch {
      return SignInFailure(error)
    }
  }

  public func signOut() async {
    await engine.signOut()
    address = nil
  }

  public func refresh() async {
    await engine.refresh()
  }

  private func receive(_ state: SyncState) {
    self.state = state
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
