import DaythreadCore
import DaythreadSync
import Testing

@testable import DaythreadUI

private func workspace() throws -> Workspace {
  try #require(Workspace(try JSON.parse(#"{"revision":1,"timezone":"UTC","pages":[],"tasks":[]}"#)))
}

/// Which screen a state shows, and what Today's account menu says: decided from the state alone.
@MainActor
@Suite struct ScreenDecisionTests {
  typealias Screen = RootViewController.Screen

  @Test func nothingToShowAndNothingWrongIsBlankWhileItStarts() {
    #expect(Screen(SyncState()) == .nothing)
    #expect(Screen(SyncState(phase: .starting, signedIn: true)) == .nothing)
  }

  @Test(arguments: [
    SyncState(phase: .starting, offline: true),
    SyncState(phase: .starting, failure: .server),
    SyncState(phase: .starting, failure: .unreadable),
    SyncState(phase: .starting, failure: .unreachable),
    SyncState(phase: .starting, offline: true, failure: .server),
    SyncState(phase: .ready, failure: .server, signedIn: true),
    SyncState(phase: .ready, offline: true),
  ])
  func nothingToShowAfterAFailureCouldNotLoad(state: SyncState) {
    #expect(Screen(state) == .couldNotLoad)
  }

  @Test func aCopyIsShownWhateverWentWrong() throws {
    let copy = try workspace()
    #expect(Screen(SyncState(phase: .starting, workspace: copy)) == .today)
    #expect(Screen(SyncState(phase: .starting, workspace: copy, offline: true)) == .today)
    #expect(Screen(SyncState(phase: .ready, workspace: copy, failure: .server)) == .today)
    #expect(Screen(SyncState(phase: .ready)) == .today)
  }

  @Test func signedOutIsSignInWhateverWentWrong() {
    #expect(Screen(SyncState(phase: .signedOut)) == .signIn)
    #expect(Screen(SyncState(phase: .signedOut, offline: true)) == .signIn)
    #expect(Screen(SyncState(phase: .signedOut, failure: .server)) == .signIn)
  }

  @Test func signOutIsOfferedOnlyWithASession() {
    typealias Row = TodayViewController.AccountRow
    let signedIn = SyncState(phase: .ready, signedIn: true)
    let local = SyncState(phase: .ready, signedIn: false)
    #expect(TodayViewController.accountRows(state: local, roundTrip: nil) == [])
    #expect(TodayViewController.accountRows(state: signedIn, roundTrip: nil) == [.signOut])
    let roundTrip = AppModel.RoundTrip(failing: 1, total: 3)
    #expect(
      TodayViewController.accountRows(state: local, roundTrip: roundTrip) == [Row.roundTrip(failing: 1, total: 3)])
  }

  @Test func theAccountMenuShowsTheAddressTheEnginePublishesWithoutASignInOnThisLaunch() {
    let launched = SyncState(phase: .ready, signedIn: true, address: "one@example.com")
    #expect(TodayViewController.accountRows(state: launched, roundTrip: nil) == [.address("one@example.com"), .signOut])
  }
}
