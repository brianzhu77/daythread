import DaythreadSync
import Foundation
import Security
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

  /// The item's `kSecAttrAccessible`, read straight from the Keychain.
  private func accessibility(of service: String) throws -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "session", kSecUseDataProtectionKeychain as String: true,
      kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    try #require(status == errSecSuccess, "status \(status)")
    let attributes = try #require(result as? [String: Any])
    return attributes[kSecAttrAccessible as String] as? String
  }

  /// A session stays on this device: it travels in no backup and no migration to another device.
  @Test func theSessionStaysOnThisDevice() throws {
    let service = "app.daythread.tests.\(UUID().uuidString)"
    let store = KeychainTokenStore(service: service)
    defer { try? store.clear() }
    let session = Session(token: "tok-1", owner: "user-1", expiresAt: Date(timeIntervalSince1970: 1_900_000_000))

    try store.write(session)
    #expect(try accessibility(of: service) == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)

    // An item kept before this rule is moved to it at the next write.
    try store.clear()
    let older: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "session", kSecUseDataProtectionKeychain as String: true,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock, kSecValueData as String: Data("{}".utf8),
    ]
    try #require(SecItemAdd(older as CFDictionary, nil) == errSecSuccess)
    try store.write(session)
    #expect(try accessibility(of: service) == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
    #expect(try store.read() == session)
  }
}
