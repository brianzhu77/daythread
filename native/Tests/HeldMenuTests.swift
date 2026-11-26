import DaythreadSync
import Testing

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
}
