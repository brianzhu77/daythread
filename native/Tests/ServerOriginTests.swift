import Foundation
import Testing
import UIKit

@testable import Daythread

/// The server's origin names the session's Keychain item and the store's file, so two servers never share either.
@Suite struct ServerOriginTests {
  private func origin(_ text: String) throws -> ServerOrigin {
    ServerOrigin(try #require(URL(string: text)))
  }

  @Test(arguments: [
    ("https://daythread.dogrod.com", "https---daythread.dogrod.com"),
    ("https://Daythread.Dogrod.COM/", "https---daythread.dogrod.com"),
    ("https://daythread.dogrod.com:443/some/path?x=1", "https---daythread.dogrod.com"),
    ("http://127.0.0.1:3741", "http---127.0.0.1-3741"),
    ("HTTP://LOCALHOST:8080/", "http---localhost-8080"),
    ("http://127.0.0.1:80", "http---127.0.0.1"),
    ("https://daythread.dogrod.com:8443", "https---daythread.dogrod.com-8443"),
  ])
  func theSlugIsTheOriginLowerCasedWithEveryOtherCharacterADash(url: String, slug: String) throws {
    #expect(try origin(url).slug == slug)
  }

  @Test func eachOriginHasItsOwnKeychainServiceAndStore() throws {
    let production = try origin("https://daythread.dogrod.com")
    let local = try origin("http://127.0.0.1:3741")
    let otherPort = try origin("http://127.0.0.1:3742")
    #expect(production.keychainService == "app.daythread.Daythread.https---daythread.dogrod.com")
    #expect(production.storeFileName == "workspace-https---daythread.dogrod.com.store")
    #expect(local.keychainService == "app.daythread.Daythread.http---127.0.0.1-3741")
    #expect(local.storeFileName == "workspace-http---127.0.0.1-3741.store")
    let all = [production, local, otherPort]
    #expect(Set(all.map(\.keychainService)).count == 3)
    #expect(Set(all.map(\.storeFileName)).count == 3)
  }

  @Test func anExplicitStoreNameOverridesTheOriginsInDebug() throws {
    let local = try origin("http://127.0.0.1:3741")
    #expect(AppDelegate.storeFileName(for: local, explicitName: "test-1") == "test-1.store")
    #expect(AppDelegate.storeFileName(for: local, explicitName: nil) == "workspace-http---127.0.0.1-3741.store")
    #expect(AppDelegate.storeFileName(for: local, explicitName: "../x") == "workspace-http---127.0.0.1-3741.store")
  }
}

/// The app that hosts the unit tests reaches no server: a Debug build's `Info.plist` names the developer's own
/// server on port 3000, which a test run must never touch, whatever starts a request (launch, becoming active, a
/// retry). A Release build always uses its `Info.plist` value; these tests run in a Debug build and cannot reach that
/// branch.
@Suite struct DebugServerTests {
  private let developers = "http://127.0.0.1:3000"

  @Test func hostingTestsWithNoArgumentReachesNoServer() {
    #expect(AppDelegate.debugServer(hostingTests: true, argument: nil, infoValue: developers) == "http://127.0.0.1:9")
  }

  @Test func hostingTestsWithAnArgumentUsesTheArgument() {
    let given = "http://127.0.0.1:3741"
    #expect(AppDelegate.debugServer(hostingTests: true, argument: given, infoValue: developers) == given)
  }

  @Test func notHostingTestsUsesTheArgumentOrElseInfoPlist() {
    #expect(AppDelegate.debugServer(hostingTests: false, argument: nil, infoValue: developers) == developers)
    let given = "http://127.0.0.1:3741"
    #expect(AppDelegate.debugServer(hostingTests: false, argument: given, infoValue: developers) == given)
  }

  /// This process hosts the tests (the sign the app reads is set here), and the delegate it launched with was put
  /// together for the discard port. The scheme's test action also passes `-DaythreadServerURL http://127.0.0.1:9`, so
  /// this holds through `xcodebuild -scheme Daythread` either way; the rule above holds it for any other way the
  /// tests are run.
  @MainActor @Test func theHostingAppTalksToTheDiscardPort() throws {
    #expect(ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil)
    let app = try #require(UIApplication.shared.delegate as? AppDelegate)
    #expect(ServerOrigin(app.server) == ServerOrigin(try #require(URL(string: "http://127.0.0.1:9"))))
  }
}
