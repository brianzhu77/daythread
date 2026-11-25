import Foundation

/// Where the session is kept between launches.
public protocol TokenStore: Sendable {
  func read() throws -> Session?
  func write(_ session: Session) throws
  func clear() throws
}

/// Keeps the session in memory, for tests and previews.
public final class MemoryTokenStore: TokenStore {
  private let session = Locked<Session?>(nil)

  public init() {}

  public func read() throws -> Session? { session.value }
  public func write(_ session: Session) throws { self.session.value = session }
  public func clear() throws { session.value = nil }
}

/// A value guarded by a lock, so a class holding it can be `Sendable` without `@unchecked`.
private final class Locked<Value: Sendable>: @unchecked Sendable {
  private let lock = NSLock()
  private var stored: Value

  init(_ value: Value) { stored = value }

  var value: Value {
    get { lock.withLock { stored } }
    set { lock.withLock { stored = newValue } }
  }
}
