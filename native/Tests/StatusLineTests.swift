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

  @Test func offline_with_only_the_request_for_todays_page_counts_no_change() async throws {
    // Today has no page, so the engine asks for it; the server cannot be reached for that request.
    let server = TestServer([
      .account(Account(owner: "one", email: "one@example.com", signIn: true)),
      .workspace(.full(try workspace(), owner: "one")),
    ])
    let tokens = MemoryTokenStore()
    try tokens.write(one)
    let engine = SyncEngine(transport: server, tokens: tokens, store: MemoryWorkspaceStore(), now: { noon })

    await engine.start()

    let state = try #require(await engine.states.first { _ in true })
    #expect(await server.sent.count == 1)
    #expect(state.pending == 0)
    #expect(StatusLine.text(state: state, keepsChanges: true) == "Offline · showing what was last loaded")
  }

  private func line(
    offline: Bool = false, pending: Int = 0, failure: SyncFailure? = nil, drafts: [DraftStatus] = [],
    keepsChanges: Bool = true, merged: Bool = false
  ) throws -> String? {
    StatusLine.text(
      state: SyncState(
        phase: .ready, workspace: try workspace(), offline: offline, pending: pending, failure: failure, drafts: drafts),
      keepsChanges: keepsChanges, pageId: "day:2026-11-25", merged: merged)
  }

  private func draft(_ state: DraftStatus.State, page: String = "day:2026-11-25") -> DraftStatus {
    DraftStatus(id: page, state: state)
  }

  @Test func offline_with_his_words_says_they_save_when_hes_back() throws {
    #expect(try line(offline: true, drafts: [draft(.offline)]) == "Offline · saves when you're back")
    #expect(try line(offline: true, drafts: [draft(.waiting)]) == "Offline · saves when you're back")
    #expect(
      try line(offline: true, pending: 1, drafts: [draft(.offline)])
        == "Offline · saves when you're back · 1 change will be sent")
    #expect(
      try line(offline: true, pending: 2, drafts: [draft(.offline)])
        == "Offline · saves when you're back · 2 changes will be sent")
    // Another day's words are not this page's.
    #expect(
      try line(offline: true, drafts: [draft(.offline, page: "day:2026-11-24")])
        == "Offline · showing what was last loaded")
  }

  @Test func a_save_that_failed_says_it_tries_again() throws {
    #expect(try line(failure: .server, drafts: [draft(.retrying)]) == "Not saved yet · trying again")
    #expect(try line(drafts: [draft(.retrying)]) == "Not saved yet · trying again")
  }

  @Test func a_draft_that_cannot_be_saved_says_it_is_kept() throws {
    #expect(try line(drafts: [draft(.stuck("This page is in Trash"))]) == "Couldn't save · draft kept")
  }

  @Test func a_merge_that_put_his_words_below_theirs_says_so() throws {
    #expect(try line(merged: true) == "Latest loaded · your changes are below their lines")
    #expect(try line(drafts: [draft(.sending)], merged: true) == "Latest loaded · your changes are below their lines")
  }

  /// 1a's line about the device comes first; then his unsaved words, before what 1a says about the copy.
  @Test func the_order_against_1as_lines() throws {
    let notKept = "Changes aren't kept on this device"
    #expect(try line(offline: true, drafts: [draft(.offline)], keepsChanges: false) == notKept)
    #expect(try line(drafts: [draft(.stuck("This page is gone"))], keepsChanges: false) == notKept)
    #expect(try line(offline: true, drafts: [draft(.stuck("This page is gone"))]) == "Couldn't save · draft kept")
    #expect(try line(failure: .server, drafts: [draft(.stuck("refused"))]) == "Couldn't save · draft kept")
    #expect(try line(offline: true, drafts: [draft(.offline)], merged: true) == "Offline · saves when you're back")
    #expect(try line(failure: .server, drafts: [draft(.retrying)], merged: true) == "Not saved yet · trying again")
    #expect(try line(failure: .server, merged: true) == "Latest loaded · your changes are below their lines")
    #expect(try line(failure: .server) == "Couldn't update · showing what was last loaded")
  }

  @Test func a_draft_on_its_way_says_nothing() throws {
    for state in [DraftStatus.State.waiting, .sending, .behind] {
      #expect(try line(drafts: [draft(state)]) == nil)
    }
  }

  @Test func nothing_wrong_says_nothing() throws {
    let copy = try workspace()
    #expect(StatusLine.text(state: SyncState(phase: .ready, workspace: copy), keepsChanges: true) == nil)
    #expect(StatusLine.text(state: SyncState(phase: .ready, workspace: copy, pending: 2), keepsChanges: true) == nil)
  }
}
