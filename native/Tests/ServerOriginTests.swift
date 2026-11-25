import Foundation
import Testing

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
