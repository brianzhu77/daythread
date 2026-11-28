import Testing

@testable import DaythreadCore

@Suite struct DraftActionTests {
  static func cases() throws -> [DraftActionCase] {
    let names = try Fixtures.draftActionNames()
    #expect(names.count == 12)
    return try names.map(Fixtures.draftActionCase)
  }

  /// The ticket a reopen case's own command carries: its items, the skip it undoes, and each day it saw.
  static func ticket(of action: JSONValue) throws -> DraftTicket {
    let object = try #require(action.objectValue)
    let seen = try #require(object["seen"]?.objectValue)
    return DraftTicket(
      itemIds: (object["itemIds"]?.arrayValue ?? []).compactMap(\.stringValue),
      skippedBy: try #require(object["skippedBy"]?.stringValue),
      seen: try seen.keys.map { key in
        DraftTicket.Seen(itemId: key, plannedOn: try seen[key]?.stringValue.map { try #require(LocalDate($0)) })
      })
  }

  /// The ids of the suggestions the draft of `pageId` shows in `workspace`.
  static func shown(_ workspace: Workspace, _ pageId: String) throws -> [String] {
    let page = try #require(workspace.page(pageId))
    return DraftView.of(page: page, in: workspace, index: TodoIndex(workspace))?.suggestions.map(\.id) ?? []
  }

  @Test func the_commands_are_written_as_the_web_writes_them() throws {
    for entry in try Self.cases() {
      let built: JSONValue
      switch entry.type {
      case "apply-draft": built = Command.applyDraft(pageId: entry.pageId, itemIds: entry.itemIds, today: entry.today)
      case "skip-draft": built = Command.skipDraft(pageId: entry.pageId, itemIds: entry.itemIds)
      case "reopen-draft": built = Command.reopenDraft(try Self.ticket(of: entry.action), pageId: entry.pageId)
      default:
        // Undo of an apply is the row's own command.
        let target = try #require(entry.action.objectValue?["targetOperationId"]?.stringValue, "\(entry.name)")
        built = Command.undo(targetOperationId: target)
      }
      #expect(JSON.write(built) == JSON.write(entry.action), "command: \(entry.name)")
    }
  }

  @Test func the_ticket_is_the_webs() throws {
    var read = 0
    for entry in try Self.cases() {
      guard let expected = entry.ticket else { continue }
      read += 1
      let index = TodoIndex(entry.after)
      let ticket = DraftTicket.of(
        itemIds: entry.itemIds, skippedBy: "cmd-\(entry.name)", draft: index.dayDraft(of: entry.pageId), index: index)
      #expect(ticket.itemIds == expected["itemIds"]?.arrayValue?.compactMap(\.stringValue), "itemIds: \(entry.name)")
      #expect(ticket.skippedBy == expected["skippedBy"]?.stringValue, "skippedBy: \(entry.name)")
      let seen = try #require(expected["seen"]?.objectValue, "seen: \(entry.name)")
      #expect(ticket.seen.map(\.itemId) == seen.keys, "seen keys: \(entry.name)")
      #expect(
        ticket.seen.map { $0.plannedOn?.value } == seen.keys.map { seen[$0]?.stringValue }, "seen days: \(entry.name)")
      // What the Undo of this skip sends keeps the web's `seen`, key for key.
      let reopen = Command.reopenDraft(ticket, pageId: entry.pageId)
      #expect(reopen.objectValue?["seen"] == .object(seen), "reopen seen: \(entry.name)")
    }
    #expect(read == 2)
  }

  @Test func a_reopen_of_a_skip_sends_the_ticket_the_skip_left() throws {
    let skip = try Fixtures.draftActionCase("dismiss-a-mix")
    let index = TodoIndex(skip.after)
    let ticket = DraftTicket.of(
      itemIds: skip.itemIds, skippedBy: "cmd-dismiss-a-mix", draft: index.dayDraft(of: skip.pageId), index: index)
    let reopen = try Fixtures.draftActionCase("reopen-after-a-skip")
    #expect(JSON.write(Command.reopenDraft(ticket, pageId: reopen.pageId)) == JSON.write(reopen.action))
    // `itemIds` holds every skipped item; a skipped line has no key in `seen`, and a to-do planned nowhere has null.
    #expect(ticket.itemIds == ["i1", "i2", "i3"])
    #expect(ticket.seen.map(\.itemId) == ["i1", "i2"])
    #expect(ticket.seen.map { $0.plannedOn?.value } == ["2026-11-25", nil])
  }

  @Test func the_answer_takes_the_suggestion_out_of_the_view() throws {
    for entry in try Self.cases() {
      let before = try Self.shown(entry.before, entry.pageId)
      let after = try Self.shown(entry.after, entry.pageId)
      if entry.refusal != nil {
        #expect(before == after, "a refusal changes nothing: \(entry.name)")
        continue
      }
      switch entry.type {
      case "apply-draft":
        if entry.name == "apply-all-partly" {
          // Three were asked and the second's to-do was done since, so the view never offered it: two are applied.
          #expect(before == ["i1", "i3"], "the done one is not offered: \(entry.name)")
        } else {
          #expect(Set(entry.itemIds).isSubset(of: Set(before)), "asked are shown before: \(entry.name)")
        }
        #expect(Set(after).isDisjoint(with: Set(entry.itemIds)), "applied are gone: \(entry.name)")
      case "skip-draft":
        #expect(Set(entry.itemIds).isSubset(of: Set(before)), "asked are shown before: \(entry.name)")
        #expect(Set(after).isDisjoint(with: Set(entry.itemIds)), "skipped are gone: \(entry.name)")
      case "reopen-draft":
        #expect(Set(entry.itemIds).isDisjoint(with: Set(before)), "skipped are hidden before: \(entry.name)")
        #expect(Set(entry.itemIds).isSubset(of: Set(after)), "brought back are shown: \(entry.name)")
      default:
        #expect(!before.contains("i1"), "the apply is hidden before: \(entry.name)")
        #expect(after.contains("i1"), "the undone apply is shown again: \(entry.name)")
      }
    }
  }

  @Test func the_notices_are_the_webs() throws {
    let words = try #require(try Fixtures.json("draft/notices.json").objectValue)
    for pair in words["applied"]?.arrayValue ?? [] {
      let entry = try #require(pair.arrayValue)
      #expect(DraftNotice.applied(try #require(entry[0].intValue)) == entry[1].stringValue)
    }
    for pair in words["skipped"]?.arrayValue ?? [] {
      let entry = try #require(pair.arrayValue)
      #expect(DraftNotice.skipped(try #require(entry[0].intValue)) == entry[1].stringValue)
    }
    #expect(DraftNotice.notApplied == words["notApplied"]?.stringValue)
    #expect(DraftNotice.notSkipped == words["notSkipped"]?.stringValue)
    #expect(DraftNotice.cantUndo == words["cantUndo"]?.stringValue)
    // The straight apostrophe and the middle dot, as the web writes them.
    #expect(DraftNotice.cantUndo.unicodeScalars.map(\.value).contains(0x27))
    #expect(DraftNotice.cantUndo.unicodeScalars.map(\.value).contains(0xB7))
  }

  @Test func the_notice_after_an_answer_is_the_servers_count() throws {
    for entry in try Self.cases() {
      guard entry.refusal == nil, let receipt = entry.receipt.flatMap(Receipt.init) else { continue }
      switch entry.type {
      case "apply-draft":
        #expect(
          DraftNotice.text(after: .apply, receipt: receipt, asked: entry.itemIds.count) == receipt.message,
          "\(entry.name)")
      case "skip-draft":
        #expect(
          DraftNotice.text(after: .skip, receipt: receipt, asked: entry.itemIds.count) == receipt.message,
          "\(entry.name)")
      default: break
      }
    }
    let partly = try Fixtures.draftActionCase("apply-all-partly")
    let receipt = try #require(partly.receipt.flatMap(Receipt.init))
    #expect(DraftNotice.text(after: .apply, receipt: receipt, asked: 3) == "Applied 2")
    #expect(DraftNotice.text(after: .apply, receipt: nil, asked: 3) == "Applied 3")
    #expect(DraftNotice.text(after: .skip, receipt: nil, asked: 1) == "Skipped")
  }

  @Test func a_skip_says_the_servers_count_where_the_web_says_the_asked_one() throws {
    // The web draws the skip before the answer and says what it asked; the app waits, so it knows.
    #expect(DraftNotice.text(after: .skip, receipt: try Self.receipt("Skipped 2"), asked: 3) == "Skipped 2")
    #expect(DraftNotice.text(after: .skip, receipt: try Self.receipt("Skipped"), asked: 3) == "Skipped")
  }

  @Test func a_receipt_that_does_not_read_as_the_decision_says_what_was_asked() throws {
    for message in [
      "Applied 0", "Applied x", "Applied 02", "Applied 99999999999999999999", "Applied 2 ", "", "Skipped 2",
      "Previous operation restored",
    ] {
      #expect(DraftNotice.text(after: .apply, receipt: try Self.receipt(message), asked: 3) == "Applied 3", "\(message)")
    }
    #expect(DraftNotice.text(after: .skip, receipt: try Self.receipt("Applied 2"), asked: 3) == "Skipped 3")
  }

  static func receipt(_ message: String) throws -> Receipt {
    try #require(Receipt(.object(["message": .string(message)])))
  }
}
