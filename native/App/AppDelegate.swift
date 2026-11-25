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
    let engine = SyncEngine(
      transport: URLSessionTransport(baseURL: Self.serverURL()), tokens: KeychainTokenStore(),
      store: Self.openStore())
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

  /// `-DaythreadServerURL <url>` (UI tests), else the build's `DaythreadServerURL`. A URL that does not parse stops a
  /// Debug build at launch; a Release build uses the production server, never another.
  private static func serverURL() -> URL {
    let arguments = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
    let text =
      arguments["DaythreadServerURL"] as? String
      ?? Bundle.main.object(forInfoDictionaryKey: "DaythreadServerURL") as? String
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

  /// `Application Support/Daythread/workspace.store`, or `<name>.store` with `-DaythreadStoreName <name>` (UI tests).
  /// The folder is left out of backups and, on iPhone and iPad, readable once the device has been unlocked after a
  /// restart. A store that cannot be opened is kept in memory for this launch, and the reason logged.
  private static func openStore() -> any WorkspaceStore {
    do {
      let folder = try FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
      ).appending(path: "Daythread", directoryHint: .isDirectory)
      try prepare(folder)
      return try SwiftDataWorkspaceStore.open(at: folder.appending(path: "\(storeName()).store"))
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

  /// A plain file name only; anything else is the default.
  private static func storeName() -> String {
    let arguments = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
    guard let name = arguments["DaythreadStoreName"] as? String,
      !name.isEmpty, name.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
    else { return "workspace" }
    return name
  }
}
