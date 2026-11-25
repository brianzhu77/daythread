import DaythreadCore
import DaythreadSync
import Testing

@testable import DaythreadUI

private func workspace() throws -> Workspace {
  try #require(Workspace(try JSON.parse(#"{"revision":1,"timezone":"UTC","pages":[],"tasks":[]}"#)))
}

/// Which screen a state shows, and what Today's prompt and account menu say: decided from the state alone.
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

  @Test func todaysPromptSaysOfflineFirstThenAFailedUpdate() throws {
    let copy = try workspace()
    #expect(TodayViewController.prompt(for: SyncState(phase: .ready, workspace: copy)) == nil)
    #expect(
      TodayViewController.prompt(for: SyncState(phase: .ready, workspace: copy, offline: true))
        == "Offline · showing what was last loaded")
    #expect(
      TodayViewController.prompt(for: SyncState(phase: .ready, workspace: copy, failure: .server))
        == "Couldn't update · showing what was last loaded")
    #expect(
      TodayViewController.prompt(for: SyncState(phase: .ready, workspace: copy, failure: .unreadable))
        == "Couldn't update · showing what was last loaded")
    #expect(
      TodayViewController.prompt(for: SyncState(phase: .ready, workspace: copy, offline: true, failure: .server))
        == "Offline · showing what was last loaded")
  }

  @Test func signOutIsOfferedOnlyWithASession() {
    typealias Row = TodayViewController.AccountRow
    let signedIn = SyncState(phase: .ready, signedIn: true)
    let local = SyncState(phase: .ready, signedIn: false)
    #expect(TodayViewController.accountRows(state: local, address: nil, roundTrip: nil) == [])
    #expect(TodayViewController.accountRows(state: signedIn, address: nil, roundTrip: nil) == [.signOut])
    #expect(
      TodayViewController.accountRows(state: signedIn, address: "one@example.com", roundTrip: nil)
        == [.address("one@example.com"), .signOut])
    let roundTrip = AppModel.RoundTrip(failing: 1, total: 3)
    #expect(
      TodayViewController.accountRows(state: local, address: nil, roundTrip: roundTrip)
        == [Row.roundTrip(failing: 1, total: 3)])
  }
}
