import DaythreadSync
import Foundation
import Testing

/// The Keychain as the signed app sees it: these run inside the app, not in a bare test process.
@Suite struct KeychainTokenStoreTests {
  @Test func writesReadsReplacesAndClears() throws {
    let store = KeychainTokenStore(service: "app.daythread.tests.\(UUID().uuidString)")
    defer { try? store.clear() }
    let first = Session(token: "tok-1", owner: "user-1", expiresAt: Date(timeIntervalSince1970: 1_798_194_615.25))
    let second = Session(token: "tok-2", owner: "user-2", expiresAt: Date(timeIntervalSince1970: 1_900_000_000))

    #expect(try store.read() == nil)
    try store.write(first)
    #expect(try store.read() == first)
    try store.write(second)
    #expect(try store.read() == second)
    try store.clear()
    #expect(try store.read() == nil)
  }
}
