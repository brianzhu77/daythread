import DaythreadCore
import DaythreadSync
import Testing
import UIKit

@testable import DaythreadUI

/// The held button's menu says what the web's banner says, for each reason a change was not saved.
@Suite struct HeldMenuTests {
  @Test func each_reason_reads_as_the_webs_sentence() {
    let label = #"ticked "Water the plants""#
    let held = [
      HeldChange(id: 1, label: label, reason: .conflict),
      HeldChange(id: 2, label: label, reason: .gone),
      HeldChange(id: 3, label: label, reason: .changedSince),
      HeldChange(id: 4, label: label, reason: .maybeApplied),
      HeldChange(id: 5, label: label, reason: .refused),
    ]

    #expect(
      HeldMenu.sections(held) == [
        .init(id: 1, title: #"Not saved — ticked "Water the plants" was changed elsewhere"#, canKeep: true),
        .init(id: 2, title: #"Not saved — "Water the plants" was deleted elsewhere"#, canKeep: false),
        .init(id: 3, title: #"Not saved — ticked "Water the plants" · changed since"#, canKeep: true),
        .init(id: 4, title: #"Not saved? — ticked "Water the plants" may already be in"#, canKeep: true),
        .init(id: 5, title: #"Not saved — can't do this now: ticked "Water the plants""#, canKeep: false),
      ])
    #expect(HeldMenu.waitingLine(1) == "1 later change waiting")
    #expect(HeldMenu.waitingLine(2) == "2 later changes waiting")
    #expect(HeldMenu.waitingLine(0) == nil)
  }

  @Test func a_gone_change_with_no_name_is_it() {
    let sections = HeldMenu.sections([HeldChange(id: 1, label: "a change", reason: .gone)])
    #expect(sections.map(\.title) == ["Not saved — it was deleted elsewhere"])
  }

  @Test func a_stuck_draft_is_a_section_titled_with_the_day_and_the_reason() throws {
    let copy = try workspaceWithYesterdayInTrash()
    let drafts = [
      DraftStatus(id: "day:2026-11-25", state: .offline),
      DraftStatus(id: "day:2026-11-24", state: .stuck("This page is in Trash")),
      DraftStatus(id: "page-gone", state: .stuck("This page is gone")),
    ]

    #expect(
      HeldMenu.draftSections(drafts, in: copy) == [
        .init(pageId: "day:2026-11-24", title: "\(DayTitle.short(for: yesterday)) · This page is in Trash"),
        .init(pageId: "page-gone", title: "This page is gone"),
      ])
  }
}

private let yesterday = LocalDate("2026-11-24")!

private let yesterdayDraft = #"[{"id":"a","type":"paragraph","props":{},"content":[{"type":"text","text":"Morning","styles":{}}],"children":[]},{"id":"b","type":"paragraph","props":{},"content":[{"type":"text","text":"Walk the dog","styles":{}}],"children":[]}]"#

/// Today's page, and yesterday's in Trash.
private func workspaceWithYesterdayInTrash() throws -> Workspace {
  let today = #"{"id":"day:2026-11-25","type":"daily","date":"2026-11-25","title":"","document":"[]"}"#
  let trashed =
    #"{"id":"day:2026-11-24","type":"daily","date":"2026-11-24","title":"","document":"[]","#
    + #""trashedAt":"2026-11-24T20:00:00.000Z","trashId":"batch-1"}"#
  return try #require(
    Workspace(try JSON.parse(#"{"revision":1,"timezone":"UTC","pages":[\#(today),\#(trashed)],"tasks":[]}"#)))
}

/// The "Not saved" menu on the day screen, for a draft the engine keeps and does not send.
@MainActor
@Suite struct StuckDraftMenuTests {
  @Test func copy_draft_puts_its_plain_text_on_the_pasteboard_and_discard_draft_is_destructive() async throws {
    let draft = PageDraft(
      pageId: "day:2026-11-24", owner: "one", base: ContentKey.of("[]"), baseDocument: "[]", document: yesterdayDraft,
      singleDeleteIds: [], sent: nil, changedAt: noon)
    let h = try await Harness(copy: try workspaceWithYesterdayInTrash(), drafts: [draft])
    try await until { h.model.state.drafts == [DraftStatus(id: "day:2026-11-24", state: .stuck("This page is in Trash"))] }
    let screen = DayViewController(model: h.model)
    screen.loadViewIfNeeded()
    screen.updatePropertiesIfNeeded()
    let pasteboard = UIPasteboard.withUniqueName()
    screen.pasteboard = pasteboard

    #expect(screen.navigationItem.rightBarButtonItems?.contains { $0.accessibilityLabel == "Not saved" } == true)
    let section = try #require(screen.heldMenu().first as? UIMenu)
    #expect(section.title == "\(DayTitle.short(for: yesterday)) · This page is in Trash")
    let actions = section.children.compactMap { $0 as? UIAction }
    #expect(actions.map(\.title) == ["Copy draft", "Discard draft"])
    #expect(actions.last?.attributes.contains(.destructive) == true)
    #expect(actions.first?.attributes.contains(.destructive) == false)

    actions.first?.performWithSender(nil, target: nil)
    try await until { pasteboard.string == "Morning\nWalk the dog" }

    actions.last?.performWithSender(nil, target: nil)
    try await until { h.model.state.drafts.isEmpty }
    screen.updatePropertiesIfNeeded()
    #expect(screen.navigationItem.rightBarButtonItems?.contains { $0.accessibilityLabel == "Not saved" } == false)
    UIPasteboard.remove(withName: pasteboard.name)
  }
}
