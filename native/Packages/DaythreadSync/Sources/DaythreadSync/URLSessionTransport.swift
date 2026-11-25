import DaythreadCore
import Foundation

/// The server's `/api/v1` over `URLSession`. Every request authenticates with `Authorization: Bearer`; the server
/// never sets a cookie for these routes, and this client would not keep one.
public struct URLSessionTransport: ServerTransport {
  private let baseURL: URL
  private let session: URLSession

  public init(baseURL: URL, session: URLSession = URLSessionTransport.makeSession()) {
    self.baseURL = baseURL
    self.session = session
  }

  /// A session that keeps no cookies and no cache: nothing the server sends is replayed, and a stale reply is never
  /// served from disk.
  public static func makeSession() -> URLSession {
    URLSession(configuration: makeConfiguration())
  }

  static func makeConfiguration() -> URLSessionConfiguration {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCache = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    return configuration
  }

  // MARK: ServerTransport

  public func signIn(email: String, password: String, timezone: String) async throws -> Session {
    let body: JSONValue = .object([
      "email": .string(email), "password": .string(password), "timezone": .string(timezone),
    ])
    let reply = try await perform(.post, "auth/sign-in", body: body)
    guard let session = Session(reply) else { throw TransportError.unreadable }
    return session
  }

  public func signOut(token: String) async throws {
    do {
      _ = try await perform(.post, "auth/sign-out", token: token, readsBody: false)
    } catch TransportError.signedOut {
      // The session is already gone, which is what signing out is for.
    }
  }

  public func account(token: String?) async throws -> Account {
    let reply = try await perform(.get, "account", token: token)
    guard
      let object = reply.objectValue, let owner = object["owner"]?.stringValue,
      let signIn = object["signIn"]?.boolValue
    else { throw TransportError.unreadable }
    return Account(owner: owner, email: object["email"]?.stringValue, signIn: signIn)
  }

  public func workspace(token: String?, have: Int?) async throws -> WorkspaceReply {
    let query = have.map { [URLQueryItem(name: "have", value: String($0))] } ?? []
    let reply = try await perform(.get, "workspace", token: token, query: query)
    guard let object = reply.objectValue, let owner = object["owner"]?.stringValue else {
      throw TransportError.unreadable
    }
    if object["unchanged"]?.boolValue == true {
      guard let revision = object["revision"]?.intValue else { throw TransportError.unreadable }
      return .unchanged(revision: revision, owner: owner)
    }
    guard let json = object["workspace"], let workspace = Workspace(json) else {
      throw TransportError.unreadable
    }
    return .full(workspace, owner: owner)
  }

  public func send(
    token: String?, operationId: String, action: JSONValue, expectedOwner: String, basis: OutboxBasis
  ) async throws -> CommandOutcome {
    let body: JSONValue = .object([
      "operationId": .string(operationId),
      "expectedRevision": .number(String(basis.baseRevision)),
      "action": action,
      "expectedOwner": .string(expectedOwner),
      "basis": .object([
        "baseRevision": .number(String(basis.baseRevision)),
        "ownRevisions": .array(basis.ownRevisions.map { .number(String($0)) }),
        "readsBeyond": .bool(basis.readsBeyond),
      ]),
    ])
    let reply = try await perform(.post, "commands", token: token, body: body)
    guard let outcome = Self.outcome(of: reply) else { throw TransportError.unreadable }
    return outcome
  }

  // MARK: Replies

  private static func outcome(of reply: JSONValue) -> CommandOutcome? {
    guard let object = reply.objectValue, let status = object["status"]?.stringValue,
      let owner = object["owner"]?.stringValue
    else { return nil }
    switch status {
    case "applied":
      guard let receipt = object["receipt"], let json = object["changes"],
        let changes = WorkspaceChanges(json)
      else { return nil }
      return .applied(receipt: receipt, changes: changes, owner: owner)
    case "held":
      guard let reason = object["reason"]?.stringValue, let rows = object["rows"]?.arrayValue,
        let stale = object["stale"]?.boolValue
      else { return nil }
      let ids = rows.compactMap(\.stringValue)
      guard ids.count == rows.count else { return nil }
      return .held(reason: reason, rows: ids, stale: stale, owner: owner)
    case "already-applied":
      return .alreadyApplied(owner: owner)
    case "refused":
      guard let message = object["message"]?.stringValue else { return nil }
      return .refused(message: message, owner: owner)
    case "owner-mismatch":
      return .ownerMismatch(owner: owner)
    default:
      return nil
    }
  }

  // MARK: Requests

  private enum Method: String { case get = "GET", post = "POST" }

  /// The body of a 2xx reply, parsed (`.null` when the caller does not read it).
  private func perform(
    _ method: Method, _ path: String, token: String? = nil, query: [URLQueryItem] = [],
    body: JSONValue? = nil, readsBody: Bool = true
  ) async throws -> JSONValue {
    var request = URLRequest(url: try url(path, query: query))
    request.httpMethod = method.rawValue
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = Data(JSON.write(body).utf8)
    }

    let data: Data, response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch let error as URLError {
      throw Self.transportError(of: error)
    }
    guard let http = response as? HTTPURLResponse else { throw TransportError.unreadable }
    let parsed = Self.parse(data)

    switch http.statusCode {
    case 200..<300:
      guard readsBody else { return .null }
      guard let parsed else { throw TransportError.unreadable }
      return parsed
    case 429:
      throw TransportError.wait(seconds: Self.wait(of: http, body: parsed))
    case 500...:
      throw TransportError.server(status: http.statusCode)
    default:
      let reason = parsed?.objectValue?["error"]?.stringValue
      if http.statusCode == 401, reason == "signed-out" { throw TransportError.signedOut }
      throw TransportError.refused(status: http.statusCode, reason: reason)
    }
  }

  private func url(_ path: String, query: [URLQueryItem]) throws -> URL {
    guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
      throw TransportError.unreadable
    }
    var prefix = components.path
    while prefix.hasSuffix("/") { prefix.removeLast() }
    components.path = "\(prefix)/api/v1/\(path)"
    components.queryItems = query.isEmpty ? nil : query
    guard let url = components.url else { throw TransportError.unreadable }
    return url
  }

  private static func parse(_ data: Data) -> JSONValue? {
    guard let text = String(data: data, encoding: .utf8) else { return nil }
    return try? JSON.parse(text)
  }

  /// The server's own wait (`retryAfter`, in seconds), else the `Retry-After` header, else a minute.
  private static func wait(of response: HTTPURLResponse, body: JSONValue?) -> Int {
    let seconds =
      body?.objectValue?["retryAfter"]?.intValue
      ?? response.value(forHTTPHeaderField: "Retry-After").flatMap { Int($0) } ?? 60
    return max(seconds, 1)
  }

  private static let offlineCodes: Set<URLError.Code> = [
    .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost, .cannotConnectToHost,
    .dataNotAllowed,
  ]

  private static func transportError(of error: URLError) -> any Error {
    if offlineCodes.contains(error.code) { return TransportError.offline }
    if error.code == .cancelled { return CancellationError() }
    return error
  }
}
