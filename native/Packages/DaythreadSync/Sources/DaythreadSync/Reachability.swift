import Network

/// Says when the device can reach a network again, so the engine need not wait out its retry schedule.
public protocol Reachability: Sendable {
  /// Yields each time a network becomes reachable after none was. Read once per engine.
  var becameReachable: AsyncStream<Void> { get }
}

/// The system's view of the network (`NWPathMonitor`): yields when the path becomes satisfied after it was not.
public struct NetworkReachability: Reachability {
  public init() {}

  public var becameReachable: AsyncStream<Void> {
    AsyncStream { continuation in
      let watching = Task {
        // The first path is where the device starts, not a change.
        var reachable: Bool?
        for await path in NWPathMonitor() {
          let now = path.status == .satisfied
          if now, reachable == false { continuation.yield() }
          reachable = now
        }
        continuation.finish()
      }
      continuation.onTermination = { _ in watching.cancel() }
    }
  }
}

/// Never yields: the engine tries again on its schedule alone.
public struct NoReachability: Reachability {
  public init() {}

  public var becameReachable: AsyncStream<Void> { AsyncStream { _ in } }
}
