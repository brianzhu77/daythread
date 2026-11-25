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
  public let baseRevision: Int
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
