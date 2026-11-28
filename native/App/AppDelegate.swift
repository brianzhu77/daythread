import DaythreadSync
import DaythreadUI
import Foundation
import UIKit
import os

/// Puts the app together once per process: the server, the store on the device, the session in the Keychain, and the
/// model every scene draws from.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  /// The server this process talks to; read by tests.
  private(set) lazy var server: URL = Self.serverURL()

  private(set) lazy var model: AppModel = {
    let server = server
    let origin = ServerOrigin(server)
    let (store, kept) = Self.openStore(origin)
    let engine = SyncEngine(
      transport: URLSessionTransport(baseURL: server), tokens: KeychainTokenStore(service: origin.keychainService),
      store: store, reachability: NetworkReachability())
    return AppModel(engine: engine, keepsChanges: kept)
  }()

  func application(
    _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    model.start()
    return true
  }

  // MARK: The server

  private static let productionURL = URL(string: "https://daythread.dogrod.com")

  /// A Debug build: `-DaythreadServerURL <url>` (UI tests) when given, else, in the app that hosts the unit tests
  /// (`XCTestConfigurationFilePath` is set only in a process that hosts a test bundle), `noServer`, else the build's
  /// `DaythreadServerURL` from `Info.plist`; a URL that does not parse stops it at launch. A Release build: always the
  /// `Info.plist` value, never a launch argument, and the production server when that value does not parse.
  private static func serverURL() -> URL {
    let infoValue = Bundle.main.object(forInfoDictionaryKey: "DaythreadServerURL") as? String
    #if DEBUG
      let text = debugServer(
        hostingTests: ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil,
        argument: launchArgument("DaythreadServerURL"), infoValue: infoValue)
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

  #if DEBUG
    /// The discard port: nothing answers there.
    nonisolated static let noServer = "http://127.0.0.1:9"

    /// A Debug build's server address: the launch argument when given; else, in a process that hosts unit tests,
    /// `noServer`; else the `Info.plist` value.
    nonisolated static func debugServer(hostingTests: Bool, argument: String?, infoValue: String?) -> String? {
      argument ?? (hostingTests ? noServer : infoValue)
    }
  #endif

  // MARK: The store

  private static let storeLog = Logger(subsystem: "app.daythread.Daythread", category: "store")

  /// `Application Support/Daythread/workspace-<origin>.store` (see `ServerOrigin`); in a Debug build,
  /// `<name>.store` with `-DaythreadStoreName <name>` (UI tests). The folder is left out of backups and, on iPhone and
  /// iPad, readable once the device has been unlocked after a restart. A store that cannot be opened is kept in memory
  /// for this launch, and the reason logged; `kept` is then false, and the screen says so.
  private static func openStore(_ origin: ServerOrigin) -> (store: any WorkspaceStore, kept: Bool) {
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
      return (try SwiftDataWorkspaceStore.open(at: folder.appending(path: file)), true)
    } catch {
      storeLog.error("The store on the device could not be opened; this launch keeps it in memory: \(error)")
      return (MemoryWorkspaceStore(), false)
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
