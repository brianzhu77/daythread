import DaythreadCore
import DaythreadSync
import Testing

@testable import DaythreadUI

private func workspace() throws -> Workspace {
  try #require(Workspace(try JSON.parse(#"{"revision":1,"timezone":"UTC","pages":[],"tasks":[]}"#)))
}

/// The line under the title: changes not kept on the device first, then offline, then an update that failed.
@Suite struct StatusLineTests {
  @Test func offline_says_how_many_changes_will_be_sent() throws {
    let copy = try workspace()
    #expect(
      StatusLine.text(state: SyncState(phase: .ready, workspace: copy, offline: true), keepsChanges: true)
        == "Offline · showing what was last loaded")
    #expect(
      StatusLine.text(state: SyncState(phase: .ready, workspace: copy, offline: true, pending: 1), keepsChanges: true)
        == "Offline · showing what was last loaded · 1 change will be sent")
    #expect(
      StatusLine.text(state: SyncState(phase: .ready, workspace: copy, offline: true, pending: 2), keepsChanges: true)
        == "Offline · showing what was last loaded · 2 changes will be sent")
    #expect(
      StatusLine.text(
        state: SyncState(phase: .ready, workspace: copy, offline: true, pending: 1, failure: .server),
        keepsChanges: true) == "Offline · showing what was last loaded · 1 change will be sent")
  }

  @Test func a_failed_update_says_it_could_not_update() throws {
    let copy = try workspace()
    #expect(
      StatusLine.text(state: SyncState(phase: .ready, workspace: copy, failure: .server), keepsChanges: true)
        == "Couldn't update · showing what was last loaded")
    #expect(
      StatusLine.text(state: SyncState(phase: .ready, workspace: copy, failure: .unreadable), keepsChanges: true)
        == "Couldn't update · showing what was last loaded")
  }

  @Test func changes_not_kept_on_the_device_win_over_both() throws {
    let copy = try workspace()
    let notKept = "Changes aren't kept on this device"
    #expect(StatusLine.text(state: SyncState(phase: .ready, workspace: copy), keepsChanges: false) == notKept)
    #expect(
      StatusLine.text(state: SyncState(phase: .ready, workspace: copy, offline: true, pending: 1), keepsChanges: false)
        == notKept)
    #expect(
      StatusLine.text(state: SyncState(phase: .ready, workspace: copy, failure: .server), keepsChanges: false)
        == notKept)
  }

  @Test func nothing_wrong_says_nothing() throws {
    let copy = try workspace()
    #expect(StatusLine.text(state: SyncState(phase: .ready, workspace: copy), keepsChanges: true) == nil)
    #expect(StatusLine.text(state: SyncState(phase: .ready, workspace: copy, pending: 2), keepsChanges: true) == nil)
  }
}
