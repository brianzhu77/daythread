import DaythreadSync
import DaythreadUI
import Foundation
import UIKit
import os

/// Puts the app together once per process: the server, the store on the device, the session in the Keychain, and the
/// model every scene draws from.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  private(set) lazy var model: AppModel = {
    let server = Self.serverURL()
    let origin = ServerOrigin(server)
    let engine = SyncEngine(
      transport: URLSessionTransport(baseURL: server), tokens: KeychainTokenStore(service: origin.keychainService),
      store: Self.openStore(origin))
    return AppModel(engine: engine)
  }()

  func application(
    _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    model.start()
    return true
  }

  // MARK: The server

  private static let productionURL = URL(string: "https://daythread.dogrod.com")

  /// A Debug build: `-DaythreadServerURL <url>` (UI tests) when given, else the build's `DaythreadServerURL` from
  /// `Info.plist`; a URL that does not parse stops it at launch. A Release build: always the `Info.plist` value, never
  /// a launch argument, and the production server when that value does not parse.
  private static func serverURL() -> URL {
    let infoValue = Bundle.main.object(forInfoDictionaryKey: "DaythreadServerURL") as? String
    #if DEBUG
      let text = launchArgument("DaythreadServerURL") ?? infoValue
    #else
      let text = infoValue
    #endif
    if let text, let url = URL(string: text), ["http", "https"].contains(url.scheme), url.host() != nil {
      return url
    }
    #if DEBUG
      fatalError("DaythreadServerURL is not a server address: \(text ?? "missing")")
    #else
      guard let productionURL else { fatalError("The production server address does not parse") }
      return productionURL
    #endif
  }

  // MARK: The store

  private static let storeLog = Logger(subsystem: "app.daythread.Daythread", category: "store")

  /// `Application Support/Daythread/workspace-<origin>.store` (see `ServerOrigin`); in a Debug build,
  /// `<name>.store` with `-DaythreadStoreName <name>` (UI tests). The folder is left out of backups and, on iPhone and
  /// iPad, readable once the device has been unlocked after a restart. A store that cannot be opened is kept in memory
  /// for this launch, and the reason logged.
  private static func openStore(_ origin: ServerOrigin) -> any WorkspaceStore {
    do {
      let folder = try FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
      ).appending(path: "Daythread", directoryHint: .isDirectory)
      try prepare(folder)
      #if DEBUG
        let explicitName = launchArgument("DaythreadStoreName")
      #else
        let explicitName: String? = nil
      #endif
      let file = storeFileName(for: origin, explicitName: explicitName)
      return try SwiftDataWorkspaceStore.open(at: folder.appending(path: file))
    } catch {
      storeLog.error("The store on the device could not be opened; this launch keeps it in memory: \(error)")
      return MemoryWorkspaceStore()
    }
  }

  private static func prepare(_ folder: URL) throws {
    var folder = folder
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try folder.setResourceValues(values)
    #if !targetEnvironment(macCatalyst)
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: folder.path)
    #endif
  }

  /// `<explicitName>.store` when the name is a plain file name, else the origin's own store.
  nonisolated static func storeFileName(for origin: ServerOrigin, explicitName: String?) -> String {
    guard let name = explicitName,
      !name.isEmpty, name.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
    else { return origin.storeFileName }
    return "\(name).store"
  }

  private static func launchArgument(_ name: String) -> String? {
    UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)[name] as? String
  }
}
