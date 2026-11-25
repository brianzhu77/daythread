import Foundation
import Security
import Testing

@testable import DaythreadSync

private let first = Session(
  token: "tok-1", owner: "user-1", expiresAt: Date(timeIntervalSince1970: 1_798_194_615.25))
private let second = Session(
  token: "tok-2", owner: "user-2", expiresAt: Date(timeIntervalSince1970: 1_900_000_000))

private func exercise(_ store: some TokenStore) throws {
  #expect(try store.read() == nil)
  try store.write(first)
  #expect(try store.read() == first)
  try store.write(second)
  #expect(try store.read() == second)
  try store.clear()
  #expect(try store.read() == nil)
  try store.clear()
}

@Suite struct MemoryTokenStoreTests {
  @Test func writesReadsAndClears() throws {
    try exercise(MemoryTokenStore())
  }

  @Test func storesAreIndependent() throws {
    let one = MemoryTokenStore(), other = MemoryTokenStore()
    try one.write(first)
    #expect(try other.read() == nil)
  }
}

@Suite struct KeychainTokenStoreTests {
  /// The status the Keychain answers a first probe with, or nil when it is usable here. A test
  /// process that is not signed with the app's entitlements may be refused (-34018) or asked to
  /// interact; those tests are skipped, saying which status came back.
  private static func unavailability(service: String) -> OSStatus? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "probe",
      kSecUseDataProtectionKeychain as String: true,
      kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail,
    ]
    let status = SecItemCopyMatching(query as CFDictionary, nil)
    return status == errSecSuccess || status == errSecItemNotFound ? nil : status
  }

  private func withStore(_ body: (KeychainTokenStore) throws -> Void) throws {
    let service = "app.daythread.tests.\(UUID().uuidString)"
    if let status = Self.unavailability(service: service) {
      try Test.cancel("The Keychain is not usable in this test process (OSStatus \(status)).")
    }
    let store = KeychainTokenStore(service: service)
    defer { try? store.clear() }
    try body(store)
  }

  @Test func writesReadsAndClears() throws {
    try withStore { try exercise($0) }
  }

  @Test func theSessionSurvivesANewStoreOnTheSameService() throws {
    try withStore { store in
      try store.write(first)
      let again = KeychainTokenStore(service: store.service)
      #expect(try again.read() == first)
    }
  }

  @Test func anUnreadableItemIsAnErrorNotASession() throws {
    try withStore { store in
      let add: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: store.service,
        kSecAttrAccount as String: KeychainTokenStore.account,
        kSecUseDataProtectionKeychain as String: true,
        kSecValueData as String: Data("not json".utf8),
      ]
      #expect(SecItemAdd(add as CFDictionary, nil) == errSecSuccess)
      #expect(throws: (any Error).self) { try store.read() }
    }
  }
}
