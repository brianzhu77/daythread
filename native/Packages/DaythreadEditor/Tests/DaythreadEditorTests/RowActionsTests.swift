#if canImport(UIKit)
  import DaythreadCore
  import Testing
  import UIKit

  @testable import DaythreadEditor

  /// The day these tests are drawn on: a Thursday.
  private let today = "2026-11-26"

  private func todo(_ id: String, status: String = "open", deadlineOn: String? = nil) -> JSONValue {
    var object = JSONObject()
    object["id"] = .string(id)
    object["title"] = .string("A to-do")
    object["status"] = .string(status)
    object["paused"] = .bool(false)
    object["deadlineOn"] = deadlineOn.map { .string($0) } ?? .null
    object["attentionOn"] = .null
    return .object(object)
  }

  /// A to-do row: a plan row on `planDate` (today when not given), or a reference row with no plan day.
  private func taskRow(_ id: String, _ taskId: String, _ words: String, reference: Bool = false, planDate: String = today)
    -> Block
  {
    var props = JSONObject()
    props["taskId"] = .string(taskId)
    props["role"] = .string(reference ? "reference" : "plan")
    if !reference { props["planDate"] = .string(planDate) }
    return block(id, "task", props, text: words)
  }

  extension OnScreen {
    @MainActor
    @Suite struct RowActionsTests {
      private func cell(_ screen: Screen, _ item: Int) throws -> TodoBlockCell {
        try #require(try screen.cell(item) as? TodoBlockCell, "row \(item) is not a to-do")
      }

      /// The trailing swipe the list would offer for a row, read from the list configuration's provider as the system
      /// asks for it.
      private func swipe(_ screen: Screen, _ item: Int) -> UISwipeActionsConfiguration? {
        _ = screen.list
        return screen.controller.listConfiguration.trailingSwipeActionsConfigurationProvider?(
          IndexPath(item: item, section: 0))
      }

      private func swipeTitles(_ screen: Screen, _ item: Int) -> [String] {
        swipe(screen, item)?.actions.compactMap(\.title) ?? []
      }

      /// The circle's menu, as the button shows it on a touch and hold: each group's title (nil for none) and its
      /// items' titles, a destructive one marked with "(destructive)".
      private func menu(_ menu: UIMenu?) -> [String] {
        (menu?.children ?? []).map { element in
          guard let group = element as? UIMenu else { return "not a group: \(element.title)" }
          let items = group.children.map { item in
            let action = item as? UIAction
            return item.title + (action?.attributes.contains(.destructive) == true ? " (destructive)" : "")
          }
          let inline = group.options.contains(.displayInline) ? "" : "(not inline) "
          return inline + (group.title.isEmpty ? "" : "\(group.title): ") + items.joined(separator: ", ")
        }
      }

      private func menuItem(_ menu: UIMenu?, _ title: String) throws -> UIAction {
        let items = (menu?.children ?? []).flatMap { ($0 as? UIMenu)?.children ?? [] }
        return try #require(items.compactMap { $0 as? UIAction }.first { $0.title == title }, "no \(title)")
      }

      private func runSwipe(_ screen: Screen, _ item: Int, _ title: String) throws {
        let action = try #require(swipe(screen, item)?.actions.first { $0.title == title }, "no swipe \(title)")
        action.handler(action, UIView(), { _ in })
      }

      /// A page of today with one row of each kind, and the requests it reports.
      private func everyKind() throws -> (screen: Screen, requests: () -> [RowRequest]) {
        let screen = try Screen.editing(
          [
            taskRow("plan", "k-plan", "Water the plants"),
            taskRow("ref", "k-ref", "Read the lease", reference: true),
            taskRow("done", "k-done", "Pay the rent"),
            taskRow("cx", "k-cx", "Return the parcel"),
            block("p", "paragraph", text: "Notes"),
          ],
          tasks: [todo("k-plan"), todo("k-ref"), todo("k-done", status: "done"), todo("k-cx", status: "cancelled")],
          today: today)
        var requests: [RowRequest] = []
        screen.controller.onRowAction = { requests.append($0) }
        return (screen, { requests })
      }

      // MARK: the swipe

      @Test func the_swipe_per_kind_of_row() throws {
        let (screen, _) = try everyKind()
        #expect(swipeTitles(screen, 0) == ["Tomorrow", "Not today", "More"])
        #expect(swipeTitles(screen, 1) == ["Plan for today", "More"])
        #expect(swipe(screen, 2) == nil, "a done row has no swipe")
        #expect(swipeTitles(screen, 3) == ["Restore"])
        #expect(swipe(screen, 4) == nil, "a text row has no swipe")

        let later = try Screen.editing(
          [taskRow("plan", "k-plan", "Water the plants", planDate: "2026-11-27")], tasks: [todo("k-plan")],
          today: today, day: "2026-11-27")
        #expect(swipeTitles(later, 0) == ["Not on Fri", "More"])

        let past = try Screen.editing(
          [taskRow("plan", "k-plan", "Water the plants", planDate: "2026-11-25")], tasks: [todo("k-plan")],
          today: today, day: "2026-11-25")
        #expect(swipeTitles(past, 0) == ["Bring to today"])

        // `Cancel task` is in More, never in the swipe.
        for item in 0..<4 { #expect(!swipeTitles(screen, item).contains("Cancel task")) }
      }

      @Test func no_swipe_action_runs_on_a_full_swipe() throws {
        let (screen, requests) = try everyKind()
        for item in [0, 1, 3] {
          let configuration = try #require(swipe(screen, item))
          #expect(!configuration.performsFirstActionWithFullSwipe, "row \(item)")
        }
        #expect(requests().isEmpty, "offering the swipe reports nothing")
      }

      @Test func the_swipe_never_starts_while_he_selects_text() throws {
        let (screen, _) = try everyKind()
        // He selects words in the reference row, its handles showing: no row offers a swipe, so a handle dragged
        // sideways never opens one.
        let line = try screen.focus(1)
        line.selectedRange = NSRange(location: 0, length: 4)
        #expect(swipe(screen, 1) == nil)
        #expect(swipe(screen, 0) == nil)
        #expect(swipe(screen, 3) == nil)

        line.selectedRange = NSRange(location: 4, length: 0)
        #expect(swipeTitles(screen, 0) == ["Tomorrow", "Not today", "More"], "a caret alone selects nothing")
      }

      @Test func the_swipe_is_not_offered_on_the_row_being_typed_in() throws {
        let (screen, _) = try everyKind()
        let line = try screen.focus(0, at: 3)
        #expect(swipe(screen, 0) == nil, "the system would take the keyboard away to open it")
        #expect(swipeTitles(screen, 1) == ["Plan for today", "More"], "every other row keeps its swipe")
        #expect(line.isFirstResponder)

        _ = try screen.focus(4)
        #expect(swipeTitles(screen, 0) == ["Tomorrow", "Not today", "More"])
      }

      // MARK: the circle's menu

      @Test func the_circles_menu_items_in_order_per_kind_of_row() throws {
        let (screen, requests) = try everyKind()
        let plan = try cell(screen, 0)
        #expect(
          menu(plan.circle.menu) == [
            "Tomorrow · Fri, Nov 27, Not today",
            "Another day: This weekend · Sat 11/28, Next week · Mon 11/30, Pick date…",
            "Cancel task (destructive)",
          ])
        #expect(!plan.circle.showsMenuAsPrimaryAction, "a tap ticks, a touch and hold opens the menu")
        #expect(
          menu(try cell(screen, 1).circle.menu) == [
            "Plan for today",
            "Another day: Tomorrow · Fri 11/27, This weekend · Sat 11/28, Next week · Mon 11/30, Pick date…",
            "Cancel task (destructive)",
          ])
        #expect(try cell(screen, 2).circle.menu == nil, "a done row has no menu: its circle only reopens it")
        #expect(menu(try cell(screen, 3).circle.menu) == ["Restore"])

        var ticks: [String] = []
        screen.controller.onTick = { ticks.append($0) }
        plan.circle.sendActions(for: .primaryActionTriggered)
        #expect(ticks == ["k-plan"], "a tap on the circle still ticks")
        #expect(requests().isEmpty)

        let past = try Screen.editing(
          [taskRow("plan", "k-plan", "Water the plants", planDate: "2026-11-25")], tasks: [todo("k-plan")],
          today: today, day: "2026-11-25")
        #expect(menu(try cell(past, 0).circle.menu) == ["Bring to today"])

        // A reference row whose to-do is planned today: no `Plan for today` in the menu.
        let planned = try Screen.editing(
          [taskRow("ref", "k-ref", "Read the lease", reference: true), taskRow("plan", "k-ref", "Read the lease")],
          tasks: [todo("k-ref")], today: today)
        #expect(
          menu(try cell(planned, 0).circle.menu) == [
            "Another day: Tomorrow · Fri 11/27, This weekend · Sat 11/28, Next week · Mon 11/30, Pick date…",
            "Cancel task (destructive)",
          ])
      }

      // MARK: what is reported

      @Test func each_action_is_reported_once_with_its_row() throws {
        let (screen, requests) = try everyKind()
        let plan = try cell(screen, 0)
        let reference = try cell(screen, 1)
        let tomorrow = try #require(LocalDate("2026-11-27"))

        try runSwipe(screen, 0, "Not today")
        try runSwipe(screen, 0, "More")
        try menuItem(plan.circle.menu, "Tomorrow · Fri, Nov 27").performWithSender(nil, target: nil)
        try menuItem(plan.circle.menu, "Pick date…").performWithSender(nil, target: nil)
        let custom = try #require(plan.line.accessibilityCustomActions?.first { $0.name == "Cancel task" })
        #expect(custom.actionHandler?(custom) == true)
        reference.planButton.sendActions(for: .primaryActionTriggered)

        let got = requests()
        #expect(
          got.map(\.kind) == [
            .action(.notToday), .more, .action(.move(tomorrow)), .action(.pickDate), .action(.cancel),
            .action(.planForTodayButton),
          ])
        #expect(got.map(\.rowID) == ["plan", "plan", "plan", "plan", "plan", "ref"])
        #expect(got.map(\.taskId) == ["k-plan", "k-plan", "k-plan", "k-plan", "k-plan", "k-ref"])
        // The menu he saw, so the host builds More's sheet from it.
        #expect(got[1].menu.more.map(\.title) == ["This weekend · Sat 11/28", "Next week · Mon 11/30", "Pick date…", "Cancel task"])
        #expect(got[5].menu.swipe.map(\.title) == ["Plan for today"])
        #expect(screen.controller.presentedViewController == nil, "the list presents nothing itself")
      }

      @Test func the_rows_frame_is_given_for_a_popover() throws {
        let (screen, _) = try everyKind()
        let cell = try cell(screen, 1)
        #expect(screen.controller.sourceRect(ofRow: "ref") == cell.frame)
        #expect(screen.controller.sourceRect(ofRow: "nowhere") == nil)
      }

      // MARK: ⌘/

      @Test func command_slash_opens_the_menu_for_the_caret_row() throws {
        let (screen, requests) = try everyKind()
        let line = try screen.focus(0, at: 5)
        #expect(try screen.takesKey(line, "/", .command))
        try screen.press(line, "/", .command)
        let cell = try cell(screen, 0)
        let point = try #require(cell.rowMenuSourcePoint, "the menu is presented")
        let caret = line.convert(line.caretRect(for: try #require(line.selectedTextRange).start), to: cell)
        #expect(abs(point.x - caret.midX) < 1 && point.y >= caret.minY - 1 && point.y <= caret.maxY + 1, "at the caret")
        // The menu the interaction gives the system is the circle's.
        let interaction = try #require(cell.rowMenuInteraction)
        let shown = interaction.delegate?.editMenuInteraction?(
          interaction, menuFor: UIEditMenuConfiguration(identifier: nil, sourcePoint: point), suggestedActions: [])
        #expect(menu(shown) == menu(cell.circle.menu))
        #expect(line.isFirstResponder, "the keyboard stays")
        #expect(line.selectedRange == NSRange(location: 5, length: 0), "and the caret")
        #expect(requests().isEmpty)

        // A done row and a text row have no menu: the key is not theirs.
        #expect(!(try screen.takesKey(try screen.focus(2), "/", .command)))
        #expect(!(try screen.takesKey(try screen.focus(4), "/", .command)))
      }

      // MARK: VoiceOver

      @Test func voiceover_custom_actions_are_the_rows_actions() throws {
        let (screen, _) = try everyKind()
        #expect(
          try cell(screen, 0).line.accessibilityCustomActions?.map(\.name) == [
            "Tomorrow · Fri, Nov 27", "Not today", "This weekend · Sat 11/28", "Next week · Mon 11/30", "Pick date…",
            "Cancel task",
          ])
        #expect(
          try cell(screen, 1).line.accessibilityCustomActions?.map(\.name) == [
            "Plan for today", "Tomorrow · Fri 11/27", "This weekend · Sat 11/28", "Next week · Mon 11/30", "Pick date…",
            "Cancel task",
          ])
        #expect(try cell(screen, 2).line.accessibilityCustomActions?.isEmpty != false)
        #expect(try cell(screen, 3).line.accessibilityCustomActions?.map(\.name) == ["Restore"])
        #expect(try screen.line(4).accessibilityCustomActions?.isEmpty != false)
      }

      // MARK: Plan for today

      @Test func plan_for_today_is_on_an_open_reference_row_only() throws {
        let screen = try Screen.editing(
          [
            taskRow("ref", "k-ref", "Read the lease and write down every question for the landlord", reference: true),
            taskRow("plan", "k-plan", "Water the plants"),
            taskRow("rdone", "k-done", "Pay the rent", reference: true),
            taskRow("rcx", "k-cx", "Return the parcel", reference: true),
            taskRow("today", "k-today", "Call the bank", reference: true),
            taskRow("today-plan", "k-today", "Call the bank"),
          ],
          tasks: [
            todo("k-ref"), todo("k-plan"), todo("k-done", status: "done"), todo("k-cx", status: "cancelled"),
            todo("k-today"),
          ],
          today: today)
        let shows = try (0..<6).map { !(try cell(screen, $0).planButton.isHidden) }
        // On an open reference row, also one already planned today (the web draws it there too).
        #expect(shows == [true, false, false, false, true, false])

        let reference = try cell(screen, 0)
        let button = reference.planButton
        #expect(button.configuration?.title == "Plan for today")
        #expect(button.configuration?.baseForegroundColor == .secondaryLabel)
        let buttonFrame = button.convert(button.bounds, to: reference)
        let words = reference.line.convert(reference.line.bounds, to: reference)
        #expect(words.maxX <= buttonFrame.minX, "the words \(words) never run under the button \(buttonFrame)")
        #expect(reference.line.bounds.height > 30, "the long words wrap beside it")
        #expect(buttonFrame.maxX <= reference.bounds.maxX)
        #expect(reference.accessibilityElements?.last as? UIView === button, "VoiceOver reaches it after the words")
      }

      @Test(arguments: [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge])
      func the_button_takes_its_own_touches_and_the_marks_line_is_the_words(category: UIContentSizeCategory) throws {
        let screen = try Screen.editing(
          [taskRow("ref", "k-ref", "Read the lease", reference: true)],
          tasks: [todo("k-ref", deadlineOn: "2026-11-27")], category: category, today: today)
        let cell = try cell(screen, 0)
        let button = cell.planButton
        #expect(cell.hitTest(button.convert(CGPoint(x: button.bounds.midX, y: button.bounds.midY), to: cell), with: nil) === button)
        #expect(
          cell.hitTest(cell.circle.convert(CGPoint(x: cell.circle.bounds.midX, y: cell.circle.bounds.midY), to: cell), with: nil)
            === cell.circle)
        // A touch on the marks line goes to the words' text view, which puts the caret in the words where it is
        // nearest to the touch.
        let content = try #require(cell.contentView as? UIListContentView)
        let marks = content.convert(try #require(content.secondaryTextLayoutGuide).layoutFrame, to: cell)
        #expect(!marks.isEmpty)
        let onMarks = CGPoint(x: marks.minX + 4, y: marks.midY)
        #expect(cell.hitTest(onMarks, with: nil) === cell.line)
        let position = try #require(cell.line.closestPosition(to: cell.convert(onMarks, to: cell.line)))
        #expect(cell.line.offset(from: cell.line.beginningOfDocument, to: position) <= 1, "the caret goes in the words")
        // The words are drawn no further than the button's leading edge, at every text size.
        let words = cell.line.convert(cell.line.bounds, to: cell)
        #expect(words.maxX <= button.convert(button.bounds, to: cell).minX)
      }

      // MARK: one action at a time

      @Test func while_an_action_is_out_other_rows_report_nothing() throws {
        let screen = try Screen.editing(
          [
            taskRow("plan", "k-plan", "Water the plants"),
            taskRow("ref", "k-ref", "Read the lease", reference: true),
            taskRow("other", "k-other", "Call the bank"),
            block("p", "paragraph", text: "Notes"),
          ],
          tasks: [todo("k-plan", deadlineOn: "2026-11-27"), todo("k-ref"), todo("k-other")], today: today)
        var requests: [RowRequest] = []
        var changes: [String] = []
        var ticks: [String] = []
        screen.controller.onRowAction = { requests.append($0) }
        screen.controller.onChange = { document, _ in changes.append(document) }
        screen.controller.onTick = { ticks.append($0) }
        let acting = try cell(screen, 0)

        screen.controller.actingRow = "plan"
        screen.window.layoutIfNeeded()
        #expect(try screen.cell(0) === acting, "the row is drawn dimmed in place")
        #expect(acting.line.attributedText.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor == .tertiaryLabel)
        let marks = (acting.contentConfiguration as? UIListContentConfiguration)?.secondaryAttributedText
        #expect(marks?.string == "Due tomorrow")
        #expect(marks?.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor == .tertiaryLabel)
        let other = try cell(screen, 2)
        #expect(other.line.attributedText.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor == .label)

        // Every row's actions report nothing.
        #expect(swipe(screen, 1) == nil)
        #expect(swipe(screen, 2) == nil)
        try menuItem(try cell(screen, 2).circle.menu, "Not today").performWithSender(nil, target: nil)
        try menuItem(acting.circle.menu, "Not today").performWithSender(nil, target: nil)
        try cell(screen, 1).planButton.sendActions(for: .primaryActionTriggered)
        let custom = try #require(other.line.accessibilityCustomActions?.first)
        #expect(custom.actionHandler?(custom) == false)
        #expect(requests.isEmpty)

        // Typing and ticking go on.
        let line = try screen.focus(2)
        line.insertText("!")
        #expect(try screen.words()[2] == "Call the bank!")
        #expect(changes.count == 1)
        acting.circle.sendActions(for: .primaryActionTriggered)
        #expect(ticks == ["k-plan"])

        screen.controller.actingRow = nil
        screen.window.layoutIfNeeded()
        #expect(acting.line.attributedText.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor == .label)
        #expect(line.isFirstResponder, "the caret stayed in the row he typed in")
        try menuItem(try cell(screen, 2).circle.menu, "Not today").performWithSender(nil, target: nil)
        #expect(requests.map(\.rowID) == ["other"])
      }

      // MARK: a row whose actions change

      @Test func a_row_whose_actions_change_keeps_its_cell_and_caret() throws {
        let screen = try Screen.editing(
          [taskRow("ref", "k-ref", "Read the lease", reference: true), block("p", "paragraph", text: "Notes")],
          tasks: [todo("k-ref")], today: today)
        let cell = try cell(screen, 0)
        let line = try screen.focus(0, at: 4)
        #expect(menu(cell.circle.menu).first == "Plan for today")
        // The to-do is planned today from another device: the row's menu loses Plan for today, the button stays.
        let planned = try makePage(
          [
            taskRow("ref", "k-ref", "Read the lease", reference: true), block("p", "paragraph", text: "Notes"),
            taskRow("plan", "k-ref", "Read the lease"),
          ],
          id: "day:\(today)", date: today, type: "daily")
        screen.controller.replace(
          document: planned.document, in: try makeWorkspace(pages: [planned], tasks: [todo("k-ref")]))
        screen.window.layoutIfNeeded()
        #expect(try screen.cell(0) === cell, "reconfigured in place")
        #expect(menu(cell.circle.menu).first?.hasPrefix("Another day") == true)
        #expect(!cell.planButton.isHidden)
        #expect(line.isFirstResponder)
        #expect(line.selectedRange == NSRange(location: 4, length: 0))
      }
    }
  }
#endif
