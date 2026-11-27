import DaythreadCore
import DaythreadSync
import Foundation
import SwiftUI
import Testing
import UIKit

@testable import DaythreadEditor
@testable import DaythreadUI

/// Thursday, the day these tests run on.
private let today = LocalDate("2026-11-26")!
private let yesterday = LocalDate("2026-11-25")!
/// A later day with a page, and one without.
private let monday = LocalDate("2026-11-30")!
private let tuesday = LocalDate("2026-12-01")!
/// The day "Sort the shed" was planned on.
private let shedDay = LocalDate("2026-11-20")!
/// A past day with no page.
private let saturdayBefore = LocalDate("2026-11-21")!
/// Noon UTC on Thursday, Nov 26 2026.
private let thursdayNoon = Date(timeIntervalSince1970: 1_795_694_400)
private let two = Session(token: "token-two", owner: "two", expiresAt: thursdayNoon.addingTimeInterval(86_400 * 30))

private func heading(_ id: String, _ words: String) -> String {
  #"{"id":"\#(id)","type":"heading","props":{"level":2},"content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}"#
}

/// A bullet holding `words` then the chip, as an event is written on a page.
private func event(_ id: String, _ words: String, _ chip: String) -> String {
  #"{"id":"\#(id)","type":"bulletListItem","props":{},"content":[{"type":"text","text":"\#(words)","styles":{}},\#(chip)],"children":[]}"#
}

/// A page that is not a day's.
private func document(_ id: String, _ title: String, _ lines: [String]) -> JSONValue {
  .object([
    "id": .string(id), "type": .string("document"), "date": .null, "title": .string(title),
    "document": .string("[\(lines.joined(separator: ","))]"),
  ])
}

private func trashed(_ page: JSONValue) -> JSONValue {
  var object = page.objectValue!
  object["trashedAt"] = .string("2026-11-26T08:00:00.000Z")
  object["trashId"] = .string("batch-1")
  return .object(object)
}

/// `fixtures/core/facts/cases.json`'s "today with all three parts", in the screens' fixtures: today's page has an
/// `Events` heading and two events, yesterday's page an all-day event of today's, a page of errands the to-dos' rows,
/// and three to-dos are set aside.
private enum AllThree {
  static let todayLines = [
    heading("h0", "TODO"), row("r-rent", "rent", "Pay the rent"), heading("h1", "Events"),
    event("ev1", "Standup with Lu ", chip("e-standup", on: today, at: "10:30")),
    event("ev2", "Dentist ", chip("e-dentist", on: today, at: "15:00")), line("notes", "Notes"),
  ]

  static func pages(todayLines: [String] = todayLines) -> [JSONValue] {
    [
      page(today, todayLines),
      page(yesterday, [event("ev3", "Lunch with Kathy ", chip("e-lunch", on: today))]),
      document(
        "errands", "Errands",
        [
          row("x-taxes", "taxes", "File the taxes", reference: true),
          row("x-invoice", "invoice", "Send the invoice", reference: true),
          row("x-report", "report", "Start the report", reference: true),
          row("x-bike", "bike", "Fix the bike", reference: true),
          row("x-paint", "paint", "Order the paint", reference: true),
          row("x-fence", "fence", "Mend the fence", reference: true),
        ]),
      page(shedDay, [row("r-shed", "shed", "Sort the shed", on: shedDay)]),
      page(monday, [line("m1", "Plans")]),
    ]
  }

  static func tasks(aside: Bool = true) -> [JSONValue] {
    [
      task("taxes", "File the taxes", due: today),
      task("invoice", "Send the invoice", due: LocalDate("2026-11-23")!),
      task("report", "Start the report", start: today),
      task("bike", "Fix the bike", due: today, paused: aside),
      task("paint", "Order the paint", due: LocalDate("2026-11-27")!),
      task("shed", "Sort the shed", paused: aside, start: shedDay),
      task("fence", "Mend the fence", paused: aside),
      task("rent", "Pay the rent", due: today),
    ]
  }

  static let dueSoon = [
    ["File the taxes", "Due today"], ["Send the invoice", "Was due Mon"], ["Start the report", "Start today"],
    ["Fix the bike", "Not today · Due today"], ["Sort the shed", "Not today"],
  ]
}

private func tags(_ rows: [DayFacts.Row]?) -> [[String]] {
  (rows ?? []).map { [$0.words, $0.tag ?? ""] }
}

/// Lets the run loop turn, so the strip's height reaches the list, then lays the screen out.
@MainActor
private func settled(_ day: RowScreen) async throws {
  day.drawn()
  try await turns()
  day.drawn()
}

/// The strip above the day's page (`native-phase-1.md` §12.2, §12.3): which parts show on which day, the facts
/// handed over only when they change, the strip's place and height in the header, the fold, and an account change.
@MainActor
@Suite(.serialized) struct DayFactsViewTests {
  private var thursday: Clock {
    let clock = Clock()
    clock.date = thursdayNoon
    return clock
  }

  private func harness(
    pages: [JSONValue] = AllThree.pages(), tasks: [JSONValue] = AllThree.tasks(), relay: StateRelay? = nil
  ) async throws -> Harness {
    try await Harness(copy: try copy(pages: pages, tasks: tasks), clock: thursday, sleep: neverEnding, relay: relay)
  }

  /// Loads `workspace` as the server's next copy and waits for the screen to draw it.
  private func load(_ h: Harness, _ day: RowScreen, _ workspace: Workspace) async throws {
    await h.server.add([.workspace(.full(workspace, owner: "one"))])
    await h.model.refresh()
    try await soon { h.model.state.workspace?.revision == workspace.revision }
    try await settled(day)
  }

  private func header(_ day: RowScreen) -> DayHeaderView { day.screen.headerView }

  /// The strip's frame in the header's coordinates.
  private func strip(_ day: RowScreen) -> CGRect {
    day.factsView.convert(day.factsView.bounds, to: header(day))
  }

  /// The header as the list lays it out: its supplementary view's frame.
  private func supplementary(_ day: RowScreen) throws -> CGRect {
    let list = try #require(day.screen.list)
    return try #require(
      list.layoutAttributesForSupplementaryElement(
        ofKind: UICollectionView.elementKindSectionHeader, at: IndexPath(item: 0, section: 0))?.frame)
  }

  private func firstRow(_ day: RowScreen) throws -> CGRect {
    let list = try #require(day.screen.list)
    return try #require(list.layoutAttributesForItem(at: IndexPath(item: 0, section: 0))?.frame)
  }

  /// The hosting controller of the strip, for the height its content asks for. Its view lies in the list's header, so
  /// it is the list's controller's child.
  private func host(_ day: RowScreen) throws -> UIHostingController<DayFactsView> {
    try #require(day.editor.children.compactMap { $0 as? UIHostingController<DayFactsView> }.first)
  }

  /// The height the strip's content needs at the strip's width.
  private func needed(_ day: RowScreen) throws -> CGFloat {
    try host(day).sizeThatFits(in: CGSize(width: strip(day).width, height: .greatestFiniteMagnitude)).height
  }

  // MARK: What shows, and when

  @Test func the_parts_follow_the_workspace_and_the_day() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)

    #expect(day.facts.events?.text == "Lunch with Kathy · 10:30 AM Standup with Lu")
    #expect(day.facts.events?.more == "+1 more")
    #expect(day.facts.eventsHeadingId == "h1")
    #expect(tags(day.facts.dueSoon) == AllThree.dueSoon)
    #expect(day.facts.notToday?.title == "Not today · 3")
    #expect(
      tags(day.facts.notToday?.rows) == [["Fix the bike", "Due today"], ["Sort the shed", ""], ["Mend the fence", "Unscheduled"]])
    #expect(!day.factsView.isHidden)

    day.screen.open(yesterday)
    try await settled(day)
    #expect(day.facts.events == nil && day.facts.notToday == nil, "yesterday: Due soon only")
    #expect(!day.facts.dueSoon.isEmpty)
    #expect(!day.factsView.isHidden)

    day.screen.open(monday)
    try await settled(day)
    #expect(day.facts.events == nil && day.facts.notToday == nil, "a later day with a page: Due soon only")
    #expect(!day.facts.dueSoon.isEmpty)
    #expect(!day.factsView.isHidden)

    day.screen.open(tuesday)
    try await settled(day)
    #expect(day.facts == .none)
    #expect(day.factsView.isHidden, "a later day without a page has no strip")

    day.screen.open(saturdayBefore)
    try await settled(day)
    #expect(tags(day.facts.dueSoon) == [["Sort the shed", "Not today"]])
    #expect(!day.factsView.isHidden, "a past day without a page has its strip")
    let empty = day.screen.emptyView.convert(day.screen.emptyView.bounds, to: nil)
    let stripInWindow = day.factsView.convert(day.factsView.bounds, to: nil)
    #expect(day.screen.emptyState?.text == "No page for Saturday, Nov 21")
    #expect(empty.minY >= stripInWindow.maxY - 0.5, "No page for … \(empty) under the strip \(stripInWindow)")
    day.close()
  }

  @Test(arguments: ["in Trash", "being made"])
  func todays_strip_shows_without_its_page(_ kind: String) async throws {
    var pages = AllThree.pages()
    if kind == "in Trash" { pages[0] = trashed(pages[0]) } else { pages.removeFirst() }
    let h = try await harness(pages: pages)
    let day = try RowScreen(h.model)
    try await settled(day)
    switch (kind, day.screen.content) {
    case ("in Trash", .inTrash?), ("being made", .askingForToday?): break
    default: Issue.record("today is \(String(describing: day.screen.content))")
    }
    #expect(day.facts.events?.text == "Lunch with Kathy · All day", "only the event on another page is read")
    #expect(day.facts.eventsHeadingId == nil)
    #expect(tags(day.facts.dueSoon).first == ["File the taxes", "Due today"])
    #expect(tags(day.facts.dueSoon).contains(["Pay the rent", "Due today"]), "no page of today holds its row")
    #expect(day.facts.notToday?.title == "Not today · 3")
    #expect(!day.factsView.isHidden)
    day.close()
  }

  // MARK: Handed over only when they change

  @Test func a_load_that_changes_the_facts_redraws_them_and_one_that_does_not_hands_nothing_over() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    let changes = day.factsModel.changes

    try await load(
      h, day,
      try copy(revision: 2, pages: AllThree.pages(), tasks: AllThree.tasks() + [task("milk", "Buy milk", due: today)]))
    #expect(tags(day.facts.dueSoon).last == ["Buy milk", "Due today"])
    #expect(day.factsModel.changes == changes + 1)

    let reads = day.screen.factsReads
    var lines = AllThree.todayLines
    lines[5] = line("notes", "Notes for the day")
    try await load(
      h, day,
      try copy(
        revision: 3, pages: AllThree.pages(todayLines: lines),
        tasks: AllThree.tasks() + [task("milk", "Buy milk", due: today)]))
    #expect(words(of: day.editor.document).contains("Notes for the day"), "the load was drawn")
    #expect(day.screen.factsReads > reads, "the facts were read for the state")
    #expect(day.factsModel.changes == changes + 1, "the same facts are not handed over again")
    day.close()
  }

  @Test func the_facts_are_not_worked_out_on_a_keystroke() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    let reads = day.screen.factsReads
    let published = h.model.state.published

    try day.type("!", atEndOf: "Notes")
    day.drawn()
    #expect(h.model.state.published == published, "no state has arrived")
    #expect(day.screen.factsReads == reads)

    try await soon { h.model.state.published != published }
    day.drawn()
    #expect(day.screen.factsReads > reads, "read once a state arrives")
    day.close()
  }

  /// The facts are read from the workspace the screen draws, his unsaved words drawn in, with that workspace's own
  /// index. A state that does not have his newest words yet (the engine is still storing them) shows it: the engine's
  /// copy, and an index of it, still have the row he removed.
  @Test func the_strip_follows_his_unsaved_words() async throws {
    let relay = StateRelay()
    let h = try await harness(relay: relay)
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(!tags(day.facts.dueSoon).contains(["Pay the rent", "Due today"]), "its row is on today's page")

    // A state from before his change, held back until the engine is busy storing it.
    relay.hold()
    await h.server.add([
      .workspace(.full(try copy(revision: 2, pages: AllThree.pages(), tasks: AllThree.tasks()), owner: "one"))
    ])
    await h.model.refresh()
    try await soon { !relay.kept.isEmpty }
    await h.store.holdPut()

    let rent = try day.line("Pay the rent")
    #expect(rent.becomeFirstResponder())
    rent.selectedRange = NSRange(location: 0, length: (rent.text as NSString).length)
    rent.deleteBackward()
    rent.deleteBackward()
    #expect(!day.words.contains("Pay the rent"), "the row is gone from the screen")
    await h.store.putHeld()
    let published = try #require(relay.kept.last?.published)
    relay.release()
    try await soon { h.model.state.published == published }
    try await settled(day)

    #expect(h.model.workspace?.dayPage(today)?.document.contains("r-rent") == true, "the state still has the row")
    #expect(tags(day.facts.dueSoon).contains(["Pay the rent", "Due today"]), "\(tags(day.facts.dueSoon))")
    await h.store.releasePut()
    day.close()
  }

  // MARK: Its place and height in the header

  @Test func an_empty_strip_takes_no_room() async throws {
    let h = try await harness(pages: [page(today, [line("a", "Morning")])], tasks: [])
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(day.facts == .none)
    #expect(day.factsView.isHidden)

    let header = header(day)
    let plain = DayHeaderView {}
    plain.show(DayHeading(for: today, today: today), status: nil)
    plain.directionalLayoutMargins = header.directionalLayoutMargins
    let width = header.bounds.width
    let alone = plain.systemLayoutSizeFitting(
      CGSize(width: width, height: 0), withHorizontalFittingPriority: .required,
      verticalFittingPriority: .fittingSizeLevel)
    #expect(abs(header.bounds.height - alone.height) <= 0.5, "\(header.bounds.height) against \(alone.height)")
    #expect(abs(try supplementary(day).height - header.bounds.height) <= 0.5)
    day.close()
  }

  @Test(arguments: [320, 402, 1024] as [CGFloat])
  func the_strip_takes_the_headers_width_inside_the_rows_margins(_ width: CGFloat) async throws {
    let h = try await harness()
    let day = try RowScreen(h.model, width: width)
    try await settled(day)
    let header = header(day)
    let margins = header.layoutMarginsGuide.layoutFrame
    let strip = strip(day)
    #expect(abs(strip.minX - margins.minX) <= 0.5, "at \(width): starts at \(strip.minX), margin \(margins.minX)")
    #expect(abs(strip.maxX - margins.maxX) <= 0.5, "at \(width): ends at \(strip.maxX), margin \(margins.maxX)")
    // The page's own lines start where the strip does.
    let notes = try day.line("Notes")
    let lineStart = notes.convert(notes.bounds, to: nil).minX
    let stripStart = day.factsView.convert(day.factsView.bounds, to: nil).minX
    #expect(abs(lineStart - stripStart) <= 1, "at \(width): the line at \(lineStart), the strip at \(stripStart)")
    #expect(abs(strip.height - (try needed(day))) <= 0.5, "at \(width): nothing of the strip is cut")
    day.close()
  }

  @Test func the_strips_words_wrap_and_its_height_follows_the_width() async throws {
    let long = String(repeating: "Write the long report ", count: 10).prefix(200)
    let tasks = [task("long", String(long), due: today)]
    var heights: [CGFloat: CGFloat] = [:]
    for width in [320, 1024] as [CGFloat] {
      let h = try await harness(pages: [page(today, [line("a", "Morning")])], tasks: tasks)
      let day = try RowScreen(h.model, width: width)
      try await settled(day)
      #expect(day.facts.dueSoon.map(\.words) == [String(long)])
      let strip = strip(day)
      heights[width] = strip.height
      #expect(abs(strip.height - (try needed(day))) <= 0.5, "at \(width): the strip is as tall as its words")
      #expect(
        abs(try supplementary(day).height - header(day).bounds.height) <= 0.5,
        "at \(width): the header's supplementary is as tall as the header")
      let fitted = header(day).systemLayoutSizeFitting(
        CGSize(width: header(day).bounds.width, height: 0), withHorizontalFittingPriority: .required,
        verticalFittingPriority: .fittingSizeLevel)
      #expect(abs(header(day).bounds.height - fitted.height) <= 0.5, "at \(width): the header holds all it has")
      day.close()
    }
    #expect(heights[320]! > heights[1024]!, "narrower, the words wrap onto more lines: \(heights)")
  }

  @Test func opening_the_fold_lays_the_header_out_again() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    let before = strip(day)
    let header = try supplementary(day)
    let row = try firstRow(day)

    day.factsModel.notTodayOpen = true
    try await settled(day)
    let grown = strip(day).height - before.height
    #expect(grown > 20, "the fold's rows show: \(grown)")
    #expect(abs((try supplementary(day).height - header.height) - grown) <= 0.5)
    #expect(abs((try firstRow(day).minY - row.minY) - grown) <= 0.5)
    #expect(abs(strip(day).height - (try needed(day))) <= 0.5)
    day.close()
  }

  @Test func the_line_being_typed_stays_when_the_strip_changes() async throws {
    let filler = (1...30).map { line("f\($0)", "Line \($0)") }
    let pages = AllThree.pages(todayLines: AllThree.todayLines + filler)
    let h = try await harness(pages: pages)
    let day = try RowScreen(h.model)
    try await settled(day)
    let notes = try day.line("Notes")
    #expect(notes.becomeFirstResponder())
    try await settled(day)
    let before = notes.convert(notes.bounds, to: nil)
    let stripBefore = strip(day).height

    try await load(
      h, day, try copy(revision: 2, pages: pages, tasks: AllThree.tasks() + [task("milk", "Buy milk", due: today)]))
    #expect(tags(day.facts.dueSoon).last == ["Buy milk", "Due today"])
    #expect(strip(day).height > stripBefore, "the strip grew")
    #expect(notes.isFirstResponder, "the keyboard stays up")
    let after = notes.convert(notes.bounds, to: nil)
    #expect(abs(after.minY - before.minY) <= 0.5, "the line was at \(before.minY), now \(after.minY)")
    day.close()
  }

  /// The page with `Notes` between filler, scrolled so `Notes` is at the top under the bar and holds the caret: the
  /// header is off screen above, so the list can move by whatever the strip changes.
  private func typingInNotes(_ day: RowScreen) async throws -> UITextView {
    #expect(day.editor.scroll(toRow: "notes", animated: false))
    try await settled(day)
    let notes = try day.line("Notes")
    #expect(notes.becomeFirstResponder())
    try await settled(day)
    return notes
  }

  private static let filler = (1...30).map { line("f\($0)", "Line \($0)") }

  /// Today's page with `Notes` lower down: filler, then `Notes`, then filler.
  private static func longToday() -> [JSONValue] {
    [page(today, Array(filler.prefix(15)) + [line("notes", "Notes")] + Array(filler.suffix(15)))]
  }

  private func expectInPlace(
    _ notes: UITextView, at before: CGRect, _ what: String, sourceLocation: SourceLocation = #_sourceLocation
  ) {
    let after = notes.convert(notes.bounds, to: nil)
    #expect(notes.isFirstResponder, "\(what): the keyboard stays up", sourceLocation: sourceLocation)
    #expect(
      abs(after.minY - before.minY) <= 0.5, "\(what): the line was at \(before.minY), now \(after.minY)",
      sourceLocation: sourceLocation)
  }

  @Test func the_line_being_typed_stays_when_the_strip_appears_shrinks_and_goes() async throws {
    let pages = Self.longToday()
    let h = try await harness(pages: pages, tasks: [task("paint", "Order the paint", due: monday)])
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(day.factsView.isHidden)
    let notes = try await typingInNotes(day)
    let before = notes.convert(notes.bounds, to: nil)

    let both = [task("taxes", "File the taxes", due: today), task("rent", "Pay the rent", due: today)]
    try await load(h, day, try copy(revision: 2, pages: pages, tasks: both))
    #expect(!day.factsView.isHidden, "the strip appeared")
    expectInPlace(notes, at: before, "appearing")

    try await load(h, day, try copy(revision: 3, pages: pages, tasks: [both[0]]))
    #expect(day.facts.dueSoon.count == 1, "a row left")
    expectInPlace(notes, at: before, "shrinking")

    let done = task("taxes", "File the taxes", status: "done", due: today)
    try await load(h, day, try copy(revision: 4, pages: pages, tasks: [done]))
    #expect(day.factsView.isHidden, "the last row left")
    expectInPlace(notes, at: before, "going")
    day.close()
  }

  @Test func the_line_being_typed_stays_when_the_fold_opens_and_closes() async throws {
    let pages = AllThree.pages(todayLines: AllThree.todayLines + Self.filler)
    let h = try await harness(pages: pages)
    let day = try RowScreen(h.model)
    try await settled(day)
    // On screen under the strip, as when he opens the fold while typing a little further down.
    let notes = try day.line("Notes")
    #expect(notes.becomeFirstResponder())
    try await settled(day)
    let before = notes.convert(notes.bounds, to: nil)
    let closed = strip(day).height

    day.factsModel.notTodayOpen = true
    try await settled(day)
    #expect(strip(day).height > closed)
    expectInPlace(notes, at: before, "opening")

    day.factsModel.notTodayOpen = false
    try await settled(day)
    #expect(abs(strip(day).height - closed) <= 0.5)
    expectInPlace(notes, at: before, "closing")
    day.close()
  }

  // MARK: How it looks

  /// The strip drawn on its own, `width` points wide at `size`, in light mode, laid out.
  private func drawnStrip(_ facts: DayFacts, width: CGFloat, size: UIContentSizeCategory, open: Bool = false) throws
    -> (UIHostingController<DayFactsView>, UIWindow)
  {
    let model = DayFactsModel()
    model.show(facts)
    model.notTodayOpen = open
    let host = UIHostingController(rootView: DayFactsView(model: model))
    host.safeAreaRegions = []
    host.view.backgroundColor = .systemBackground
    let window = try testWindow(width: width)
    window.overrideUserInterfaceStyle = .light
    let root = UIViewController()
    root.traitOverrides.preferredContentSizeCategory = size
    window.rootViewController = root
    window.makeKeyAndVisible()
    root.addChild(host)
    root.view.addSubview(host.view)
    host.didMove(toParent: root)
    let height = host.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude)).height
    host.view.frame = CGRect(x: 0, y: 0, width: width, height: height)
    window.layoutIfNeeded()
    host.view.layoutIfNeeded()
    return (host, window)
  }

  /// The view's pixels, one per point, as RGBA bytes.
  private func pixels(of view: UIView) throws -> (bytes: [UInt8], width: Int, height: Int) {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let image = UIGraphicsImageRenderer(bounds: view.bounds, format: format).image { _ in
      _ = view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
    }
    let cg = try #require(image.cgImage)
    let width = cg.width
    let height = cg.height
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    try bytes.withUnsafeMutableBytes { buffer in
      let context = try #require(
        CGContext(
          data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
      context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
    return (bytes, width, height)
  }

  /// The runs of pixel rows that hold ink (anything clearly darker than the page or the box), top to bottom.
  private func inkBands(of view: UIView) throws -> [ClosedRange<Int>] {
    let (bytes, width, height) = try pixels(of: view)
    var bands: [ClosedRange<Int>] = []
    var start: Int?
    for y in 0..<height {
      let ink = (0..<width).contains { x in
        let i = (y * width + x) * 4
        let red = 0.2126 * Double(bytes[i])
        let green = 0.7152 * Double(bytes[i + 1])
        let blue = 0.0722 * Double(bytes[i + 2])
        return (red + green + blue) / 255 < 0.75
      }
      if ink, start == nil { start = y }
      if !ink, let first = start {
        bands.append(first...(y - 1))
        start = nil
      }
    }
    if let first = start { bands.append(first...(height - 1)) }
    // A row of a pixel or two at an edge is the view's own antialiased border, not ink.
    return bands.filter { $0.count > 2 }
  }

  /// Today's facts with only `Due soon`: one row per title, each `Was due Mon`.
  private func dueSoonOnly(_ titles: [String]) throws -> DayFacts {
    let workspace = try copy(
      pages: [page(today, [line("a", "Morning")])],
      tasks: titles.enumerated().map { task("t\($0.offset)", $0.element, due: LocalDate("2026-11-23")!) })
    return DayFacts.of(day: today, in: workspace, index: TodoIndex(workspace), today: today)
  }

  @Test func due_soon_rows_are_44_points_apart() throws {
    let (host, window) = try drawnStrip(try dueSoonOnly(["Taxes", "Rent"]), width: 402, size: .large)
    let bands = try inkBands(of: host.view)
    // The box's label, then one line per row: the tag beside the words.
    try #require(bands.count == 3, "bands: \(bands)")
    let apart = bands[2].lowerBound - bands[1].lowerBound
    #expect(apart >= 44, "rows \(apart) apart")
    window.isHidden = true
  }

  @Test func at_the_largest_size_a_rows_tag_is_nearer_its_own_words_than_the_next_row() throws {
    let (host, window) = try drawnStrip(
      try dueSoonOnly(["File taxes", "Pay the rent"]), width: 402, size: .accessibilityExtraExtraExtraLarge)
    let bands = try inkBands(of: host.view)
    // The label, then each row's words and its tag under them.
    try #require(bands.count == 5, "bands: \(bands) in \(host.view.bounds)")
    let wordsToTag = bands[2].lowerBound - bands[1].upperBound
    let tagToNext = bands[3].lowerBound - bands[2].upperBound
    #expect(wordsToTag < tagToNext, "words to tag \(wordsToTag), tag to the next row \(tagToNext)")
    window.isHidden = true
  }

  /// Quiet controls, as the web's: nothing in the strip is drawn in the accent colour, or in any colour.
  @Test func the_strip_draws_no_accent_colour() throws {
    let workspace = try copy(pages: AllThree.pages(), tasks: AllThree.tasks())
    let facts = DayFacts.of(day: today, in: workspace, index: TodoIndex(workspace), today: today)
    let (host, window) = try drawnStrip(facts, width: 402, size: .large, open: true)
    let (bytes, width, height) = try pixels(of: host.view)
    let coloured = stride(from: 0, to: width * height * 4, by: 4).filter { i in
      let channels = [bytes[i], bytes[i + 1], bytes[i + 2]].map(Int.init)
      return channels.max()! - channels.min()! > 64
    }.count
    #expect(coloured == 0, "\(coloured) coloured pixels")
    window.isHidden = true
  }

  @Test func at_the_accessibility_sizes_the_events_line_takes_more_than_one_line() throws {
    // Two events and nothing else: today's page holds one, yesterday's the other.
    let workspace = try copy(
      pages: [
        page(today, [event("ev1", "Standup with Lu ", chip("e-standup", on: today, at: "10:30"))]),
        page(yesterday, [event("ev3", "Lunch with Kathy ", chip("e-lunch", on: today))]),
      ], tasks: [])
    let facts = DayFacts.of(day: today, in: workspace, index: TodoIndex(workspace), today: today)
    #expect(facts.events?.text == "Lunch with Kathy · 10:30 AM Standup with Lu")
    #expect(facts.dueSoon.isEmpty && facts.notToday == nil)
    for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
      let font = UIFont.preferredFont(
        forTextStyle: .subheadline, compatibleWith: UITraitCollection(preferredContentSizeCategory: category))
      let (host, window) = try drawnStrip(facts, width: 402, size: category)
      let fitted = host.sizeThatFits(in: CGSize(width: CGFloat(402), height: CGFloat.greatestFiniteMagnitude))
      if category.isAccessibilityCategory {
        #expect(fitted.height > font.lineHeight * 1.5, "\(fitted.height) for a line of \(font.lineHeight)")
      } else {
        #expect(fitted.height < font.lineHeight * 1.9, "one line: \(fitted.height) for a line of \(font.lineHeight)")
      }
      #expect(fitted.width <= 402.5, "nothing wider than the strip: \(fitted.width)")
      window.isHidden = true
    }
  }

  /// The horizontal reach of the ink in `band`: its leftmost and rightmost inked columns.
  private func inkReach(of view: UIView, in band: ClosedRange<Int>) throws -> ClosedRange<Int> {
    let (bytes, width, _) = try pixels(of: view)
    let columns = (0..<width).filter { x in
      band.contains { y in
        let i = (y * width + x) * 4
        let luminance = (0.2126 * Double(bytes[i]) + 0.7152 * Double(bytes[i + 1]) + 0.0722 * Double(bytes[i + 2]))
        return luminance / 255 < 0.75
      }
    }
    return try #require(columns.first)...(try #require(columns.last))
  }

  /// At the accessibility sizes `+N more` and the chevron go on a line of their own under the words, so the words
  /// have the whole width after the symbol: drawn with them, the words' lines are exactly those drawn without them.
  @Test func at_the_accessibility_sizes_more_goes_under_the_words() throws {
    func facts(more: Bool) throws -> DayFacts {
      var todayLines = [event("ev1", "Standup with Lu ", chip("e-standup", on: today, at: "10:30"))]
      if more {
        // An `Events` heading makes the line a button, with its chevron; a third event gives `+1 more`.
        todayLines = [heading("h1", "Events")] + todayLines
          + [event("ev2", "Dentist ", chip("e-dentist", on: today, at: "15:00"))]
      }
      let workspace = try copy(
        pages: [
          page(today, todayLines), page(yesterday, [event("ev3", "Lunch with Kathy ", chip("e-lunch", on: today))]),
        ], tasks: [])
      return DayFacts.of(day: today, in: workspace, index: TodoIndex(workspace), today: today)
    }
    let withMore = try facts(more: true)
    let without = try facts(more: false)
    #expect(withMore.events?.text == "Lunch with Kathy · 10:30 AM Standup with Lu")
    #expect(withMore.events?.more == "+1 more" && withMore.eventsHeadingId == "h1")
    #expect(without.events?.text == withMore.events?.text && without.events?.more == nil)

    let size = UIContentSizeCategory.accessibilityExtraExtraExtraLarge
    let (moreHost, moreWindow) = try drawnStrip(withMore, width: 402, size: size)
    let (plainHost, plainWindow) = try drawnStrip(without, width: 402, size: size)
    let moreBands = try inkBands(of: moreHost.view)
    let plainBands = try inkBands(of: plainHost.view)
    try #require(plainBands.count >= 2, "the words take more than one line: \(plainBands)")
    #expect(moreBands.count == plainBands.count + 1, "one line more, for `+1 more`: \(moreBands) against \(plainBands)")
    for (index, band) in plainBands.enumerated() where index < moreBands.count {
      #expect(moreBands[index] == band, "line \(index) of the words is where it is without `+1 more`")
      #expect(
        try inkReach(of: moreHost.view, in: moreBands[index]) == (try inkReach(of: plainHost.view, in: band)),
        "line \(index) of the words reaches as far as without `+1 more`")
    }
    // `Lunch` is whole on the first line: the line reaches past the symbol by at least the word's width.
    let font = UIFont.preferredFont(
      forTextStyle: .subheadline, compatibleWith: UITraitCollection(preferredContentSizeCategory: size))
    let lunch = ("Lunch" as NSString).size(withAttributes: [.font: font]).width
    let first = try inkReach(of: plainHost.view, in: plainBands[0])
    #expect(CGFloat(first.count) > lunch + font.pointSize, "the first line reaches \(first.count) points")
    for host in [moreHost, plainHost] {
      let fitted = host.sizeThatFits(in: CGSize(width: CGFloat(402), height: CGFloat.greatestFiniteMagnitude))
      #expect(fitted.width <= 402.5, "nothing wider than the strip: \(fitted.width)")
    }
    moreWindow.isHidden = true
    plainWindow.isHidden = true
  }

  @Test func at_the_largest_text_size_the_strip_grows_and_keeps_its_width() async throws {
    var measured: [(height: CGFloat, width: CGFloat, margins: CGFloat)] = []
    for size in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
      let h = try await harness()
      let day = try RowScreen(h.model, size: size)
      try await settled(day)
      let strip = strip(day)
      measured.append((strip.height, strip.width, header(day).layoutMarginsGuide.layoutFrame.width))
      #expect(abs(strip.height - (try needed(day))) <= 0.5, "at \(size.rawValue) nothing is cut")
      // A tag wider than the strip would make the content wider than its host, which centres it and cuts both edges.
      let content = try host(day).sizeThatFits(in: CGSize(width: strip.width, height: .greatestFiniteMagnitude))
      #expect(content.width <= strip.width + 0.5, "at \(size.rawValue) the content is \(content.width) wide in \(strip.width)")
      day.close()
    }
    #expect(measured[1].height > measured[0].height)
    #expect(abs(measured[1].width - measured[1].margins) <= 0.5, "the width is the margins': \(measured)")
  }

  // MARK: The fold

  @Test func the_fold_is_closed_at_first_and_forgotten_off_today() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(!day.factsModel.notTodayOpen)

    day.factsModel.notTodayOpen = true
    day.screen.open(yesterday)
    try await settled(day)
    day.screen.open(nil)
    try await settled(day)
    #expect(day.facts.notToday != nil)
    #expect(!day.factsModel.notTodayOpen, "leaving today forgets the fold")

    day.factsModel.notTodayOpen = true
    try await load(h, day, try copy(revision: 2, pages: AllThree.pages(), tasks: AllThree.tasks(aside: false)))
    #expect(day.facts.notToday == nil)
    #expect(!day.factsModel.notTodayOpen, "the list emptied: the fold is forgotten")
    day.close()
  }

  @Test func the_fold_survives_a_new_host() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    day.factsModel.notTodayOpen = true
    try await settled(day)
    let width = strip(day).width
    let height = strip(day).height

    let second = UIHostingController(rootView: DayFactsView(model: day.factsModel))
    // As the screen's host: the window's safe area is not the strip's.
    second.safeAreaRegions = []
    let window = try testWindow(width: 402)
    window.rootViewController = second
    window.makeKeyAndVisible()
    window.layoutIfNeeded()
    #expect(day.factsModel.notTodayOpen)
    let again = second.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude)).height
    #expect(abs(again - height) <= 0.5, "the new host draws the fold open: \(again) against \(height)")
    window.isHidden = true
    day.close()
  }

  // MARK: Accounts and controls

  @Test func an_account_change_empties_the_strip() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    #expect(!day.factsView.isHidden)

    await h.server.add([.done])
    #expect(await h.model.signOut(discardingUnsent: true) == .signedOut)
    try await soon { h.model.state.workspace == nil }
    try await settled(day)
    #expect(day.facts == .none, "no copy shown: no facts of the first account")
    #expect(day.factsView.isHidden)

    let theirs = try copy(
      revision: 5, pages: [page(today, [line("a", "Morning")])], tasks: [task("plumber", "Call the plumber", due: today)])
    await h.server.add([.session(two), .workspace(.full(theirs, owner: "two"))])
    #expect(await h.model.signIn(email: "two@example.com", password: "secret") == nil)
    try await soon { h.model.state.owner == "two" && h.model.state.workspace != nil }
    try await settled(day)
    #expect(tags(day.facts.dueSoon) == [["Call the plumber", "Due today"]], "their own facts")
    #expect(day.facts.notToday == nil && day.facts.events == nil)
    #expect(!day.factsView.isHidden)
    day.close()
  }

  /// The labels are read from the rows the strip draws: SwiftUI builds no accessibility tree for a unit test to read
  /// (the hosting view reports no elements unless an assistive technology asks), so the view's use of them is seen
  /// by VoiceOver and Voice Control only.
  @Test func each_bring_back_names_its_own_to_do() async throws {
    let h = try await harness()
    let day = try RowScreen(h.model)
    try await settled(day)
    let rows = try #require(day.facts.notToday?.rows)
    #expect(
      rows.map(\.bringBackLabel) == ["Bring back Fix the bike", "Bring back Sort the shed", "Bring back Mend the fence"])
    // Voice Control's "Bring back" still works: the title on screen is the first name the button answers to.
    #expect(rows.map(\.bringBackInputLabels) == rows.map { ["Bring back", "Bring back \($0.words)"] })
    day.close()
  }

  @Test func the_controls_report_only_while_enabled() throws {
    let facts = DayFacts.of(
      day: today, in: try copy(pages: AllThree.pages(), tasks: AllThree.tasks()),
      index: TodoIndex(try copy(pages: AllThree.pages(), tasks: AllThree.tasks())), today: today)
    let items = try #require(facts.notToday?.menu.items)
    let move = try #require(items.first)
    let pick = try #require(items.last)
    #expect(move.title == "Tomorrow · Fri 11/27")
    #expect(pick.title == "Pick date…")

    let model = DayFactsModel()
    model.show(facts)
    var reports: [String] = []
    model.onEvents = { reports.append("events") }
    model.onBringBack = { reports.append("back \($0)") }
    model.onAnotherDay = { reports.append("move \($0) \($1.value)") }
    model.onPickDate = { reports.append("pick \($0)") }

    model.enabled = false
    model.eventsTapped()
    model.bringBack("bike")
    model.choose(move, for: "bike")
    model.choose(pick, for: "bike")
    #expect(reports.isEmpty)

    model.enabled = true
    model.eventsTapped()
    model.bringBack("bike")
    model.choose(move, for: "bike")
    model.choose(pick, for: "bike")
    #expect(reports == ["events", "back bike", "move bike 2026-11-27", "pick bike"])
  }
}
