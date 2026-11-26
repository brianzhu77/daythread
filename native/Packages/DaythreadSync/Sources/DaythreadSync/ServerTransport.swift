import DaythreadCore
import Foundation

/// A signed-in session: the bearer token the server issued and the account it belongs to.
public struct Session: Sendable, Equatable {
  public let token: String
  public let owner: String
  public let expiresAt: Date

  public init(token: String, owner: String, expiresAt: Date) {
    self.token = token
    self.owner = owner
    self.expiresAt = expiresAt
  }
}

/// The token is a credential: no description, debug description or dump of a session shows it.
extension Session: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
  public var description: String { "Session(owner: \(owner), expiresAt: \(expiresAt), token: <redacted>)" }
  public var debugDescription: String { description }
  public var customMirror: Mirror {
    Mirror(self, children: ["owner": owner, "expiresAt": expiresAt, "token": "<redacted>"], displayStyle: .struct)
  }
}

extension Session {
  /// Nil when the token, owner or expiry is missing or the expiry is not a date.
  init?(_ json: JSONValue) {
    guard
      let object = json.objectValue, let token = object["token"]?.stringValue, !token.isEmpty,
      let owner = object["owner"]?.stringValue,
      let expiresAt = object["expiresAt"]?.stringValue.flatMap(Date.init(iso8601:))
    else { return nil }
    self.init(token: token, owner: owner, expiresAt: expiresAt)
  }

  func json() -> JSONValue {
    .object([
      "token": .string(token), "owner": .string(owner), "expiresAt": .string(expiresAt.iso8601),
    ])
  }
}

extension Date {
  private static var millisecondStyle: Date.ISO8601FormatStyle {
    Date.ISO8601FormatStyle(includingFractionalSeconds: true)
  }

  /// The server writes `toISOString()`; a whole-second spelling is accepted too.
  init?(iso8601 text: String) {
    if let date = try? Date(text, strategy: Self.millisecondStyle) {
      self = date
    } else if let date = try? Date(text, strategy: Date.ISO8601FormatStyle()) {
      self = date
    } else {
      return nil
    }
  }

  var iso8601: String { formatted(Self.millisecondStyle) }
}

/// Who the server says the session is.
public struct Account: Sendable, Equatable {
  public let owner: String
  public let email: String?
  /// False when the server runs with sign-in off.
  public let signIn: Bool

  public init(owner: String, email: String?, signIn: Bool) {
    self.owner = owner
    self.email = email
    self.signIn = signIn
  }
}

public enum TransportError: Error, Equatable {
  /// The device could not reach the server.
  case offline
  /// The server no longer knows the session.
  case signedOut
  /// The server said no: sign-in's `wrong`, `unconfirmed` or `not-invited`, or a request it would not read.
  case refused(status: Int, reason: String?)
  /// Too many tries; the seconds to wait.
  case wait(seconds: Int)
  case server(status: Int)
  /// The server answered, but not with anything this client can read.
  case unreadable
}

public enum WorkspaceReply: Sendable {
  case unchanged(revision: Int, owner: String)
  case full(Workspace, owner: String)
}

/// What a queued change was built on: the revision it started from and the rows' revisions it read.
public struct OutboxBasis: Sendable, Equatable {
  public var baseRevision: Int
  public var ownRevisions: [Int]
  public var readsBeyond: Bool

  public init(baseRevision: Int, ownRevisions: [Int], readsBeyond: Bool) {
    self.baseRevision = baseRevision
    self.ownRevisions = ownRevisions
    self.readsBeyond = readsBeyond
  }
}

public enum CommandOutcome: Sendable {
  case applied(receipt: JSONValue, changes: WorkspaceChanges, owner: String)
  case held(reason: String, rows: [String], stale: Bool, owner: String)
  case alreadyApplied(owner: String)
  case refused(message: String, owner: String)
  case ownerMismatch(owner: String)
}

/// What the server did with a page's save (`POST /api/v1/saves`).
public enum SaveOutcome: Sendable {
  case applied(receipt: JSONValue, changes: WorkspaceChanges, owner: String)
  /// 409 `{ error: "refused" }`: the server's message, which says why ("Page changed elsewhere…", "Saved elsewhere…").
  case refused(message: String)
  /// 409 `{ error: "owner-mismatch" }`: the session is another account than the save was made under.
  case ownerMismatch(owner: String)
}

/// The server as the sync engine sees it. A `nil` token is for a server with sign-in off.
public protocol ServerTransport: Sendable {
  func signIn(email: String, password: String, timezone: String) async throws -> Session
  func signOut(token: String) async throws
  func account(token: String?) async throws -> Account
  func workspace(token: String?, have: Int?) async throws -> WorkspaceReply
  func send(
    token: String?, operationId: String, action: JSONValue, expectedOwner: String, basis: OutboxBasis
  ) async throws -> CommandOutcome
  /// A 400 (a body the server will never accept) throws `TransportError.refused(status: 400, …)`.
  func save(
    token: String?, operationId: String, expectedRevision: Int, expectedOwner: String, action: JSONValue
  ) async throws -> SaveOutcome
}
