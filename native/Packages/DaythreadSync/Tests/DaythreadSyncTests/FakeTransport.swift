import DaythreadCore
import Foundation

@testable import DaythreadSync

/// A server that answers from a script, one reply per call in the order the calls come, and writes down every call.
/// A gated reply waits until the test opens its gate, so a test can act while a call is in flight without sleeping.
actor FakeTransport: ServerTransport {
  enum Call: Equatable, Sendable {
    case signIn(email: String, timezone: String)
    case signOut(token: String)
    case account(token: String?)
    case workspace(token: String?, have: Int?)
    case send(token: String?, operationId: String, action: JSONValue, expectedOwner: String, basis: OutboxBasis)

    var operationId: String? {
      if case .send(_, let operationId, _, _, _) = self { operationId } else { nil }
    }
  }

  enum Reply: Sendable {
    case session(Session)
    case done
    case account(Account)
    case workspace(WorkspaceReply)
    case outcome(CommandOutcome)
    case failure(any Error)
    case gated(Gate)
  }

  /// A call the script had no fitting reply for.
  struct Unscripted: Error, Equatable {
    let call: Call
  }

  private var script: [Reply]
  private(set) var calls: [Call] = []
  private(set) var unscripted: [Call] = []
  /// The calls that got a reply, in the order they got it; a call still held at a gate is not here.
  private(set) var answered: [Call] = []
  /// While set, every call fails for lack of network and no reply of the script is used.
  private(set) var unreachable = false
  private(set) var inFlight = 0
  private(set) var maxInFlight = 0
  private var inspect: (@Sendable (Call) async -> Void)?

  init(_ script: [Reply] = []) {
    self.script = script
  }

  func add(_ replies: [Reply]) {
    script += replies
  }

  /// Runs `body` when a call arrives, before it is answered.
  func onCall(_ body: @escaping @Sendable (Call) async -> Void) {
    inspect = body
  }

  func goOffline() { unreachable = true }
  func comeBack() { unreachable = false }

  /// The calls that sent a command, in order.
  var sends: [Call] { calls.filter { $0.operationId != nil } }

  // MARK: ServerTransport

  func signIn(email: String, password: String, timezone: String) async throws -> Session {
    guard case .session(let session) = try await answer(.signIn(email: email, timezone: timezone)) else {
      throw mismatch(.signIn(email: email, timezone: timezone))
    }
    return session
  }

  func signOut(token: String) async throws {
    guard case .done = try await answer(.signOut(token: token)) else { throw mismatch(.signOut(token: token)) }
  }

  func account(token: String?) async throws -> Account {
    guard case .account(let account) = try await answer(.account(token: token)) else {
      throw mismatch(.account(token: token))
    }
    return account
  }

  func workspace(token: String?, have: Int?) async throws -> WorkspaceReply {
    guard case .workspace(let reply) = try await answer(.workspace(token: token, have: have)) else {
      throw mismatch(.workspace(token: token, have: have))
    }
    return reply
  }

  func send(
    token: String?, operationId: String, action: JSONValue, expectedOwner: String, basis: OutboxBasis
  ) async throws -> CommandOutcome {
    let call = Call.send(
      token: token, operationId: operationId, action: action, expectedOwner: expectedOwner, basis: basis)
    guard case .outcome(let outcome) = try await answer(call) else { throw mismatch(call) }
    return outcome
  }

  // MARK: Script

  private func answer(_ call: Call) async throws -> Reply {
    calls.append(call)
    inFlight += 1
    maxInFlight = max(maxInFlight, inFlight)
    defer { inFlight -= 1 }
    if let inspect { await inspect(call) }
    if unreachable { throw TransportError.offline }
    guard !script.isEmpty else {
      unscripted.append(call)
      throw Unscripted(call: call)
    }
    var reply = script.removeFirst()
    if case .gated(let gate) = reply { reply = await gate.wait() }
    if case .failure(let error) = reply { throw error }
    answered.append(call)
    return reply
  }

  private func mismatch(_ call: Call) -> Unscripted {
    unscripted.append(call)
    return Unscripted(call: call)
  }
}

/// Holds a call until the test opens it with the reply it should get.
actor Gate {
  private var arrived = false
  private var arrivals: [CheckedContinuation<Void, Never>] = []
  private var reply: FakeTransport.Reply?
  private var waiting: CheckedContinuation<FakeTransport.Reply, Never>?

  /// Returns once a call is waiting at the gate.
  func reached() async {
    if arrived { return }
    await withCheckedContinuation { arrivals.append($0) }
  }

  func open(_ reply: FakeTransport.Reply) {
    if let waiting {
      self.waiting = nil
      waiting.resume(returning: reply)
    } else {
      self.reply = reply
    }
  }

  fileprivate func wait() async -> FakeTransport.Reply {
    arrived = true
    for arrival in arrivals { arrival.resume() }
    arrivals = []
    if let reply { return reply }
    return await withCheckedContinuation { waiting = $0 }
  }
}
