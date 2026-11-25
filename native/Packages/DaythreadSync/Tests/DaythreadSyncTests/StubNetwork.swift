import Foundation

@testable import DaythreadSync

/// One request as the server would have seen it.
struct RecordedRequest: Sendable {
  let method: String
  let url: URL
  let headers: [String: String]
  let body: Data?

  var path: String { url.path }
  var query: String? { url.query }

  func header(_ name: String) -> String? {
    headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
  }

  var bodyText: String? { body.flatMap { String(data: $0, encoding: .utf8) } }
}

enum StubAnswer: Sendable {
  case reply(status: Int, headers: [String: String] = [:], body: String = "")
  case failure(URLError.Code)
}

/// A server that exists only for one test: its host name is unique, so tests running side by side
/// never see each other's requests, and nothing leaves the process.
final class StubServer: @unchecked Sendable {
  private static let lock = NSLock()
  nonisolated(unsafe) private static var servers: [String: StubServer] = [:]

  let host = "stub-\(UUID().uuidString.lowercased()).test"
  private let state = NSLock()
  private var recorded: [RecordedRequest] = []
  private var answer: StubAnswer = .reply(status: 200, body: "{}")

  init() {
    Self.lock.withLock { Self.servers[host] = self }
  }

  deinit {
    let host = host
    Self.lock.withLock { _ = Self.servers.removeValue(forKey: host) }
  }

  var baseURL: URL { URL(string: "https://\(host)")! }

  var requests: [RecordedRequest] { state.withLock { recorded } }

  func answer(_ next: StubAnswer) { state.withLock { answer = next } }

  func answer(status: Int, json: String, headers: [String: String] = [:]) {
    answer(.reply(status: status, headers: headers, body: json))
  }

  func transport(baseURL: URL? = nil) -> URLSessionTransport {
    let configuration = URLSessionTransport.makeConfiguration()
    configuration.protocolClasses = [StubProtocol.self]
    return URLSessionTransport(baseURL: baseURL ?? self.baseURL, session: URLSession(configuration: configuration))
  }

  fileprivate static func server(for host: String?) -> StubServer? {
    guard let host else { return nil }
    return lock.withLock { servers[host] }
  }

  fileprivate func record(_ request: RecordedRequest) -> StubAnswer {
    state.withLock {
      recorded.append(request)
      return answer
    }
  }
}

final class StubProtocol: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    guard let url = request.url, let server = StubServer.server(for: url.host) else {
      client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
      return
    }
    let recorded = RecordedRequest(
      method: request.httpMethod ?? "GET", url: url,
      headers: request.allHTTPHeaderFields ?? [:], body: bodyData())
    switch server.record(recorded) {
    case .failure(let code):
      client?.urlProtocol(self, didFailWithError: URLError(code))
    case .reply(let status, let headers, let body):
      let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: Data(body.utf8))
      client?.urlProtocolDidFinishLoading(self)
    }
  }

  override func stopLoading() {}

  private func bodyData() -> Data? {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return nil }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
      let count = stream.read(&buffer, maxLength: buffer.count)
      if count <= 0 { break }
      data.append(buffer, count: count)
    }
    return data
  }
}
