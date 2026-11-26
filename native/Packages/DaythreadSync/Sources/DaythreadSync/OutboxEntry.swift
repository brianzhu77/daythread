import DaythreadCore
import Foundation

/// A change the user made, written down before it is sent.
public struct OutboxEntry: Sendable, Equatable, Identifiable {
  /// One queue for both; only `command` is sent in phase 0.
  public enum Kind: String, Sendable { case command, save }
  public enum State: String, Sendable { case pending, held }

  public var id: Int { seq }
  public let seq: Int
  public let kind: Kind
  public let owner: String
  public let operationId: String
  public let action: JSONValue
  /// Moves only when he keeps a held entry: it is sent again on the copy's revision then.
  public var baseRevision: Int
  public var ownRevisions: [Int]
  public let label: String
  public let createdAt: Date
  public var state: State
  public var reason: String?

  public init(
    seq: Int, kind: Kind, owner: String, operationId: String, action: JSONValue, baseRevision: Int,
    ownRevisions: [Int], label: String, createdAt: Date, state: State, reason: String?
  ) {
    self.seq = seq
    self.kind = kind
    self.owner = owner
    self.operationId = operationId
    self.action = action
    self.baseRevision = baseRevision
    self.ownRevisions = ownRevisions
    self.label = label
    self.createdAt = createdAt
    self.state = state
    self.reason = reason
  }
}

extension OutboxEntry {
  /// The engine's own request for today's page: never shown, and removed rather than held.
  var asksForADay: Bool { Command.type(of: action) == "ensure-day" }

  /// The status a `task-status` asks for; nil for any other action.
  var wantedStatus: TodoTask.Status? {
    guard Command.taskId(of: action) != nil, let status = action.objectValue?["status"]?.stringValue else { return nil }
    return TodoTask.Status(rawValue: status)
  }
}

extension [OutboxEntry] {
  /// The `seq`s of pending entries behind a held one for the same to-do, for entries in `seq` order. Such an entry
  /// is drawn but not sent, so it is not answered before the held one he has not decided on yet.
  var waiting: Set<Int> { waiting(behind: []) }

  /// As `waiting`, with the pending entries whose operation ids are in `unsettled` holding back those behind them as a
  /// held one does, while the engine settles them.
  func waiting(behind unsettled: Set<String>) -> Set<Int> {
    var heldTasks = Set<[UInt8]>()
    var waiting = Set<Int>()
    for entry in self {
      // Ids compare by code units, as they do in the domain.
      guard let id = Command.taskId(of: entry.action) else { continue }
      let taskId = [UInt8](id.utf8)
      if entry.state == .held || unsettled.contains(entry.operationId) {
        heldTasks.insert(taskId)
      } else if heldTasks.contains(taskId) {
        waiting.insert(entry.seq)
      }
    }
    return waiting
  }
}

/// An entry before the store has numbered it.
public struct NewOutboxEntry: Sendable {
  public let kind: OutboxEntry.Kind
  public let owner: String
  public let operationId: String
  public let action: JSONValue
  public let baseRevision: Int
  public let ownRevisions: [Int]
  public let label: String
  public let createdAt: Date
  public let state: OutboxEntry.State
  public let reason: String?

  public init(
    kind: OutboxEntry.Kind, owner: String, operationId: String, action: JSONValue,
    baseRevision: Int, ownRevisions: [Int], label: String, createdAt: Date,
    state: OutboxEntry.State, reason: String?
  ) {
    self.kind = kind
    self.owner = owner
    self.operationId = operationId
    self.action = action
    self.baseRevision = baseRevision
    self.ownRevisions = ownRevisions
    self.label = label
    self.createdAt = createdAt
    self.state = state
    self.reason = reason
  }

  func numbered(_ seq: Int) -> OutboxEntry {
    OutboxEntry(
      seq: seq, kind: kind, owner: owner, operationId: operationId, action: action,
      baseRevision: baseRevision, ownRevisions: ownRevisions, label: label, createdAt: createdAt,
      state: state, reason: reason)
  }
}
