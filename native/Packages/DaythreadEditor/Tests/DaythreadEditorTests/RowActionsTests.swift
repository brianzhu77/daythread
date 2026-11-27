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
        // A touch on the marks line goes to the words' text view, as a touch below its words does: the caret goes in
        // the words, at their end (the text view's closest position to a point under its last line).
        let content = try #require(cell.contentView as? UIListContentView)
        let marks = content.convert(try #require(content.secondaryTextLayoutGuide).layoutFrame, to: cell)
        #expect(!marks.isEmpty)
        let onMarks = CGPoint(x: marks.minX + 4, y: marks.midY)
        #expect(cell.hitTest(onMarks, with: nil) === cell.line)
        let position = try #require(cell.line.closestPosition(to: cell.convert(onMarks, to: cell.line)))
        #expect(cell.line.offset(from: cell.line.beginningOfDocument, to: position) == ("Read the lease" as NSString).length)
        // The words never run under the button, at any text size: beside them it starts where they end; from the
        // accessibility sizes it is under the words and the marks, the words keeping the row's width, inside the row.
        let words = cell.line.convert(cell.line.bounds, to: cell)
        let buttonFrame = button.convert(button.bounds, to: cell)
        #expect(!words.intersects(buttonFrame) && !marks.intersects(buttonFrame))
        #expect(cell.bounds.insetBy(dx: -0.5, dy: -0.5).contains(buttonFrame), "nothing of the button is cut")
        if category.isAccessibilityCategory {
          #expect(buttonFrame.minY >= marks.maxY - 0.5, "under the marks")
          #expect(abs(buttonFrame.minX - words.minX) < 0.5, "where the words start")
          let plain = try Screen.editing(
            [taskRow("plan", "k-plan", "Read the lease")], tasks: [todo("k-plan")], category: category, today: today)
          #expect(abs(try self.cell(plain, 0).line.bounds.width - cell.line.bounds.width) < 0.5, "the words keep the width")
        } else {
          #expect(words.maxX <= buttonFrame.minX)
        }
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

      // MARK: a request that has gone stale

      /// Today's page with `blocks`, as the server sends it in its workspace with `tasks`.
      private func page(_ blocks: [Block], tasks: [JSONValue]) throws -> (document: String, workspace: Workspace) {
        let page = try makePage(blocks, id: "day:\(today)", date: today, type: "daily")
        return (page.document, try makeWorkspace(pages: [page], tasks: tasks))
      }

      @Test func an_open_menu_item_run_after_its_row_left_reports_nothing() throws {
        let (screen, requests) = try everyKind()
        let item = try menuItem(try cell(screen, 0).circle.menu, "Not today")
        let more = try #require(swipe(screen, 0)?.actions.first { $0.title == "More" })
        // The server moved the to-do away: its row is not on the page any more.
        let moved = try page(
          [taskRow("ref", "k-ref", "Read the lease", reference: true), block("p", "paragraph", text: "Notes")],
          tasks: [todo("k-plan"), todo("k-ref")])
        screen.controller.replace(document: moved.document, in: moved.workspace)
        screen.window.layoutIfNeeded()
        item.performWithSender(nil, target: nil)
        more.handler(more, UIView(), { _ in })
        #expect(requests().isEmpty)
      }

      @Test func an_open_menu_item_whose_action_left_the_rows_menu_reports_nothing() throws {
        let (screen, requests) = try everyKind()
        let plan = try cell(screen, 0)
        let notToday = try menuItem(plan.circle.menu, "Not today")
        let more = try #require(swipe(screen, 0)?.actions.first { $0.title == "More" })
        let custom = try #require(plan.line.accessibilityCustomActions?.first { $0.name == "Not today" })
        // Cancelled on another device: the row's one action is now Restore.
        let cancelled = try page(
          [taskRow("plan", "k-plan", "Water the plants"), block("p", "paragraph", text: "Notes")],
          tasks: [todo("k-plan", status: "cancelled")])
        screen.controller.replace(document: cancelled.document, in: cancelled.workspace)
        screen.window.layoutIfNeeded()
        #expect(try screen.cell(0) === plan, "reconfigured in place")
        #expect(menu(plan.circle.menu) == ["Restore"])
        notToday.performWithSender(nil, target: nil)
        more.handler(more, UIView(), { _ in })
        _ = custom.actionHandler?(custom)
        #expect(requests().isEmpty)
      }

      @Test func an_open_menu_item_whose_action_is_still_offered_reports_the_current_menu() throws {
        let (screen, requests) = try everyKind()
        let tomorrow = try #require(LocalDate("2026-11-27"))
        let item = try menuItem(try cell(screen, 0).circle.menu, "Tomorrow · Fri, Nov 27")
        // Planned tomorrow on another device: Tomorrow is no longer first, but Another day still holds it.
        let planned = try makePage(
          [taskRow("later", "k-plan", "Water the plants", planDate: "2026-11-27")], id: "day:2026-11-27",
          date: "2026-11-27", type: "daily")
        let blocks = [taskRow("plan", "k-plan", "Water the plants"), block("p", "paragraph", text: "Notes")]
        let mine = try makePage(blocks, id: "day:\(today)", date: today, type: "daily")
        screen.controller.replace(
          document: mine.document, in: try makeWorkspace(pages: [mine, planned], tasks: [todo("k-plan")]))
        screen.window.layoutIfNeeded()
        let now = try cell(screen, 0).circle.menu
        #expect(menu(now).first == "Remove from Thu")
        item.performWithSender(nil, target: nil)
        let got = requests()
        #expect(got.map(\.kind) == [.action(.move(tomorrow))], "reported once")
        #expect(got.first?.menu.groups.first?.items.map(\.title) == ["Remove from Thu"], "with the menu as it is now")
      }

      @Test func the_button_reports_only_while_the_row_offers_it() throws {
        let (screen, requests) = try everyKind()
        let reference = try cell(screen, 1)
        let done = try page(
          [
            taskRow("plan", "k-plan", "Water the plants"), taskRow("ref", "k-ref", "Read the lease", reference: true),
          ],
          tasks: [todo("k-plan"), todo("k-ref", status: "done")])
        screen.controller.replace(document: done.document, in: done.workspace)
        screen.window.layoutIfNeeded()
        #expect(reference.planButton.isHidden)
        reference.planButton.sendActions(for: .primaryActionTriggered)
        #expect(requests().isEmpty)
      }

      // MARK: the button's place

      @Test func plan_for_today_ends_at_the_rows_trailing_margin() throws {
        let long = "A paragraph long enough to wrap, so its words reach the trailing margin of the row on a phone"
        let screen = try Screen.editing(
          [taskRow("ref", "k-ref", "Read the lease", reference: true), block("p", "paragraph", text: long)],
          tasks: [todo("k-ref")], today: today)
        let reference = try cell(screen, 0)
        let paragraph = try screen.line(1)
        let title = try #require(reference.planButton.titleLabel)
        let titleFrame = title.convert(title.bounds, to: screen.list)
        let margin = paragraph.convert(paragraph.bounds, to: screen.list).maxX
        #expect(abs(titleFrame.maxX - margin) < 1, "the title ends at \(titleFrame.maxX), the margin is \(margin)")
        let words = reference.line.convert(reference.line.bounds, to: screen.list)
        #expect(abs(titleFrame.minX - words.maxX - 8) < 1, "the gap before the title is \(titleFrame.minX - words.maxX)")
      }

      @Test func plan_for_today_follows_bold_text() throws {
        let screen = try Screen.editing(
          [taskRow("ref", "k-ref", "Read the lease", reference: true)], tasks: [todo("k-ref")], today: today)
        // Bold Text is carried inside the text style's font, not as the descriptor's bold trait: the title's font is the
        // caption font the system gives for that weight.
        let regular = UIFont.preferredFont(
          forTextStyle: .caption1, compatibleWith: UITraitCollection(legibilityWeight: .regular))
        let heavier = UIFont.preferredFont(
          forTextStyle: .caption1, compatibleWith: UITraitCollection(legibilityWeight: .bold))
        #expect(regular != heavier)
        func bold() throws -> Bool {
          let title = try cell(screen, 0).planButton.configuration?.attributedTitle
          let font = try #require(title?.runs.first?.uiKit.font)
          #expect(font == regular || font == heavier, "the caption font, \(font)")
          return font == heavier
        }
        #expect(!(try bold()))
        screen.window.traitOverrides.legibilityWeight = .bold
        screen.window.layoutIfNeeded()
        #expect(try bold())
        screen.window.traitOverrides.legibilityWeight = .regular
        screen.window.layoutIfNeeded()
        #expect(!(try bold()))
      }

      // MARK: dimming

      private func colour(_ line: LineTextView, at offset: Int) -> UIColor? {
        line.attributedText.attribute(.foregroundColor, at: offset, effectiveRange: nil) as? UIColor
      }

      @Test func a_row_off_screen_takes_the_dimmed_look_when_it_scrolls_in() throws {
        let filler = (0..<40).map { block("f\($0)", "paragraph", text: "Line \($0)") }
        let screen = try Screen.editing(
          filler + [taskRow("plan", "k-plan", "Water the plants")], tasks: [todo("k-plan")], height: 400,
          today: today)
        let last = IndexPath(item: 40, section: 0)
        // Near enough for the list to make the cell ahead of time, not on screen.
        screen.list.scrollToItem(at: IndexPath(item: 30, section: 0), at: .bottom, animated: false)
        screen.list.layoutIfNeeded()
        screen.controller.actingRow = "plan"
        screen.list.scrollToItem(at: last, at: .bottom, animated: false)
        screen.list.layoutIfNeeded()
        let cell = try #require(screen.list.cellForItem(at: last) as? TodoBlockCell)
        #expect(colour(cell.line, at: 0) == .tertiaryLabel)
        screen.controller.actingRow = nil
        screen.list.layoutIfNeeded()
        #expect(colour(cell.line, at: 0) == .label)
      }

      @Test(arguments: [NSRange(location: 5, length: 0), NSRange(location: 4, length: 5)])
      func dimming_the_row_being_typed_in_keeps_the_caret_and_the_keyboard(selection: NSRange) throws {
        let screen = try Screen.editing(
          [taskRow("plan", "k-plan", "Water the plants"), block("p", "paragraph", text: "Notes")],
          tasks: [todo("k-plan")], today: today)
        var changes = 0
        screen.controller.onChange = { _, _ in changes += 1 }
        let line = try screen.focus(0)
        line.selectedRange = selection
        let watch = KeyboardWatch(screen)
        screen.controller.actingRow = "plan"
        screen.window.layoutIfNeeded()
        #expect(colour(line, at: 0) == .tertiaryLabel)
        #expect(line.isFirstResponder)
        #expect(line.selectedRange == selection)
        screen.controller.actingRow = nil
        screen.window.layoutIfNeeded()
        #expect(colour(line, at: 0) == .label)
        #expect(line.isFirstResponder)
        #expect(line.selectedRange == selection)
        #expect(changes == 0, "dimming reports nothing")
        #expect(watch.droppedWhileTyping == 0)
      }

      @Test func typing_while_dimmed_lands_at_the_caret_in_the_dimmed_look() throws {
        let screen = try Screen.editing(
          [taskRow("plan", "k-plan", "Water the plants"), block("p", "paragraph", text: "Notes")],
          tasks: [todo("k-plan")], today: today)
        var changes = 0
        screen.controller.onChange = { _, _ in changes += 1 }
        let line = try screen.focus(0, at: 5)
        screen.controller.actingRow = "plan"
        screen.window.layoutIfNeeded()
        line.insertText("!")
        screen.window.layoutIfNeeded()
        #expect(try screen.words()[0] == "Water! the plants")
        #expect(line.selectedRange == NSRange(location: 6, length: 0))
        #expect(colour(line, at: 5) == .tertiaryLabel)
        #expect(changes == 1)
        screen.controller.actingRow = nil
        screen.window.layoutIfNeeded()
        #expect(colour(line, at: 5) == .label)
        #expect(line.selectedRange == NSRange(location: 6, length: 0))
      }

      @Test func dimming_a_row_being_composed_in_waits_for_the_composition() throws {
        let screen = try Screen.editing(
          [taskRow("plan", "k-plan", "Water the plants"), block("p", "paragraph", text: "Notes")],
          tasks: [todo("k-plan")], today: today)
        let line = try screen.focus(0)
        line.setMarkedText("今", selectedRange: NSRange(location: 1, length: 0))
        let marked = try #require(line.markedTextRange)
        screen.controller.actingRow = "plan"
        screen.window.layoutIfNeeded()
        #expect(line.markedTextRange != nil, "the marked text is left alone")
        #expect(line.text(in: marked) == "今")
        line.unmarkText()
        screen.window.layoutIfNeeded()
        #expect(try screen.words()[0] == "Water the plants今")
        #expect(colour(line, at: 0) == .tertiaryLabel, "dimmed once the composition ends")
        #expect(line.isFirstResponder)
        screen.controller.actingRow = nil
        screen.window.layoutIfNeeded()
        #expect(colour(line, at: 0) == .label)
      }
    }
  }
#endif
