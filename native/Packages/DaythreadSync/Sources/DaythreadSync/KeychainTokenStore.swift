import DaythreadCore
import Foundation
import Security

public struct KeychainError: Error, Equatable, Sendable {
  /// The `OSStatus` the Keychain answered with, or nil when the stored item could not be read.
  public let status: OSStatus?
}

/// Keeps the session as JSON in one generic-password Keychain item, readable once the device has been unlocked
/// after a restart (so a background refresh can use it).
public final class KeychainTokenStore: TokenStore {
  static let account = "session"
  let service: String

  public init(service: String = "app.daythread.Daythread") {
    self.service = service
  }

  private var identity: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: Self.account,
      kSecUseDataProtectionKeychain as String: true,
    ]
  }

  public func read() throws -> Session? {
    var query = identity
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw KeychainError(status: status) }
    guard
      let data = result as? Data, let text = String(data: data, encoding: .utf8),
      let json = try? JSON.parse(text), let session = Session(json)
    else { throw KeychainError(status: nil) }
    return session
  }

  public func write(_ session: Session) throws {
    let data = Data(JSON.write(session.json()).utf8)
    let update = SecItemUpdate(identity as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if update == errSecSuccess { return }
    guard update == errSecItemNotFound else { throw KeychainError(status: update) }
    var item = identity
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    let add = SecItemAdd(item as CFDictionary, nil)
    guard add == errSecSuccess else { throw KeychainError(status: add) }
  }

  public func clear() throws {
    let status = SecItemDelete(identity as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
  }
}
