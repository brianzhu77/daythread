import Testing
import UIKit

@testable import DaythreadUI

/// The waits the notice asks for, kept for the test to end or to see cancelled: no test waits real seconds.
actor Waits {
  private(set) var requested: [Duration] = []
  private(set) var cancelled: Set<Int> = []
  private var pending: [Int: CheckedContinuation<Void, any Error>] = [:]

  func wait(_ duration: Duration) async throws {
    let id = requested.count
    requested.append(duration)
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
        if cancelled.contains(id) {
          continuation.resume(throwing: CancellationError())
        } else {
          pending[id] = continuation
        }
      }
    } onCancel: {
      Task { await self.cancel(id) }
    }
  }

  /// Lets wait number `index` run out.
  func release(_ index: Int) {
    pending.removeValue(forKey: index)?.resume()
  }

  private func cancel(_ id: Int) {
    cancelled.insert(id)
    pending.removeValue(forKey: id)?.resume(throwing: CancellationError())
  }
}

/// What the test decides about VoiceOver, and what the notice did with it.
@MainActor
final class Switches {
  var voiceOver = false
  var announced: [String] = []
  var undone: [String] = []
}

/// A notice over a screen in a window, with a text field that holds the keyboard.
@MainActor
final class NoticeFixture {
  let waits = Waits()
  let switches = Switches()
  let notice: NoticeView
  let host = UIViewController()
  let field = UITextField()
  let window: UIWindow

  /// `navigationBar`: the height the host's safe area leaves for the bar the notice must not cover.
  init(width: CGFloat = 393, navigationBar: CGFloat = 96) throws {
    let waits = waits
    let switches = switches
    notice = NoticeView(
      sleep: { try await waits.wait($0) },
      voiceOverRunning: { switches.voiceOver },
      announce: { switches.announced.append($0) })
    notice.onUndo = { switches.undone.append($0) }
    window = try testWindow(width: width)
    host.additionalSafeAreaInsets.top = navigationBar
    host.view.addSubview(field)
    notice.translatesAutoresizingMaskIntoConstraints = false
    host.view.addSubview(notice)
    NSLayoutConstraint.activate([
      notice.topAnchor.constraint(equalTo: host.view.topAnchor),
      notice.bottomAnchor.constraint(equalTo: host.view.bottomAnchor),
      notice.leadingAnchor.constraint(equalTo: host.view.leadingAnchor),
      notice.trailingAnchor.constraint(equalTo: host.view.trailingAnchor),
    ])
    window.rootViewController = host
    window.isHidden = false
    layout()
  }

  isolated deinit {
    window.isHidden = true
  }

  func layout() {
    host.view.setNeedsLayout()
    host.view.layoutIfNeeded()
    notice.layoutIfNeeded()
  }

  func show(_ notice: Notice) {
    self.notice.show(notice)
    layout()
  }

  var surface: UIVisualEffectView? { descendants(of: notice).compactMap { $0 as? UIVisualEffectView }.first }

  /// The buttons a person could press: not hidden, nor inside anything hidden.
  var buttons: [UIButton] {
    descendants(of: notice).compactMap { $0 as? UIButton }.filter(isVisible)
  }

  var words: [String] {
    descendants(of: notice).compactMap { $0 as? UILabel }.filter { isVisible($0) && !isInsideButton($0) }.compactMap(\.text)
  }

  var label: UILabel? { descendants(of: notice).compactMap { $0 as? UILabel }.first { !isInsideButton($0) } }

  func press(_ button: UIButton) {
    button.sendActions(for: .primaryActionTriggered)
  }

  /// Gives the notice's own task the moment it needs to start its wait.
  func requestedWaits(_ count: Int) async throws -> [Duration] {
    if !(try await within { await waits.requested.count >= count }) {
      Issue.record("Timed out waiting for \(count) waits")
    }
    return await waits.requested
  }

  func cancelledWait(_ index: Int) async throws -> Bool {
    try await within { await waits.cancelled.contains(index) }
  }

  /// Long enough for a wait the notice should not ask for to show itself.
  func settle() async throws {
    try await Task.sleep(nanoseconds: 60_000_000)
  }

  func stays(until condition: () -> Bool) async throws {
    if !(try await within { condition() }) { Issue.record("Timed out waiting") }
  }

  /// Whether `condition` holds, checked a few milliseconds at a time for up to ten seconds. The deadline is long
  /// because the wait is not what is measured: CI's machines are several times slower than this one.
  private func within(_ condition: () async -> Bool) async throws -> Bool {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: .seconds(10))
    while !(await condition()) {
      guard clock.now < deadline else { return false }
      try await Task.sleep(nanoseconds: 5_000_000)
    }
    return true
  }

  private func isInsideButton(_ view: UIView) -> Bool {
    var current = view.superview
    while let candidate = current {
      if candidate is UIButton { return true }
      current = candidate.superview
    }
    return false
  }

  private func isVisible(_ view: UIView) -> Bool {
    var current: UIView? = view
    while let candidate = current, candidate !== host.view {
      if candidate.isHidden || candidate.alpha == 0 { return false }
      current = candidate.superview
    }
    return true
  }
}

@MainActor
private func descendants(of view: UIView) -> [UIView] {
  view.subviews.flatMap { [$0] + descendants(of: $0) }
}

private let moved = Notice(text: "Moved to Fri, Nov 27", kind: .done, undoing: "op-1")

@MainActor
@Suite struct NoticeViewTests {
  @Test func the_notice_shows_its_words_and_one_button() throws {
    let fixture = try NoticeFixture()
    #expect(fixture.words == [])
    #expect(fixture.buttons.isEmpty)

    fixture.show(moved)

    #expect(fixture.words == ["Moved to Fri, Nov 27"])
    #expect(fixture.buttons.map { $0.configuration?.title } == ["Undo"])
    #expect(fixture.notice.shown == moved)
  }

  @Test func a_notice_with_nothing_to_undo_has_no_button() throws {
    let fixture = try NoticeFixture()

    fixture.show(Notice(text: "Planned for today", kind: .done, undoing: nil))

    #expect(fixture.words == ["Planned for today"])
    #expect(fixture.buttons.isEmpty)
  }

  @Test func it_leaves_after_eight_seconds_undone_after_four_a_failure_after_six() async throws {
    let fixture = try NoticeFixture()

    fixture.show(moved)
    #expect(try await fixture.requestedWaits(1) == [.seconds(8)])
    await fixture.waits.release(0)
    try await fixture.stays { fixture.notice.shown == nil }
    #expect(fixture.words == [])

    fixture.show(Notice(text: "Undone", kind: .undone, undoing: nil))
    #expect(try await fixture.requestedWaits(2).last == .seconds(4))

    fixture.show(Notice(text: "Not done · your text is kept", kind: .failed, undoing: nil))
    #expect(try await fixture.requestedWaits(3).last == .seconds(6))
  }

  @Test func a_new_notice_replaces_the_one_showing() async throws {
    let fixture = try NoticeFixture()
    fixture.show(Notice(text: "Moved to Fri, Nov 27", kind: .done, undoing: "first"))
    _ = try await fixture.requestedWaits(1)
    let firstButton = try #require(fixture.buttons.first)

    fixture.show(Notice(text: "Restored", kind: .done, undoing: "second"))

    #expect(fixture.words == ["Restored"])
    #expect(try await fixture.cancelledWait(0))
    // The first one's time is not counted against the second.
    await fixture.waits.release(0)
    try await fixture.settle()
    #expect(fixture.notice.shown?.text == "Restored")
    // Its button can no longer fire.
    fixture.press(firstButton)
    #expect(fixture.switches.undone == [])
    fixture.press(try #require(fixture.buttons.first))
    #expect(fixture.switches.undone == ["second"])
    // The second leaves on its own time.
    _ = try await fixture.requestedWaits(2)
    await fixture.waits.release(1)
    try await fixture.stays { fixture.notice.shown == nil }
  }

  @Test func a_swipe_up_dismisses_it() throws {
    let fixture = try NoticeFixture()
    fixture.show(moved)
    let swipe = try #require(fixture.surface?.gestureRecognizers?.compactMap { $0 as? UISwipeGestureRecognizer }.first)
    #expect(swipe.direction == .up)

    fixture.notice.swipedUp()

    #expect(fixture.notice.shown == nil)
    #expect(fixture.buttons.isEmpty)
  }

  @Test func a_tap_on_the_words_does_nothing() throws {
    let fixture = try NoticeFixture()
    fixture.show(moved)
    let taps = fixture.surface?.gestureRecognizers?.filter { $0 is UITapGestureRecognizer } ?? []
    #expect(taps.isEmpty)
    #expect(fixture.notice.shown == moved)
  }

  @Test func undo_reports_its_operation_once() throws {
    let fixture = try NoticeFixture()
    fixture.show(moved)
    let button = try #require(fixture.buttons.first)

    fixture.press(button)
    fixture.press(button)

    #expect(fixture.switches.undone == ["op-1"])
  }

  @Test func withdrawn_the_button_leaves_and_does_not_come_back() async throws {
    let fixture = try NoticeFixture()
    fixture.show(moved)
    let button = try #require(fixture.buttons.first)

    fixture.notice.withdrawUndo()
    fixture.layout()

    #expect(fixture.buttons.isEmpty)
    #expect(fixture.words == ["Moved to Fri, Nov 27"])
    #expect(fixture.notice.shown == Notice(text: moved.text, kind: .done, undoing: nil))
    // The old button reports nothing, and a second withdrawal changes nothing.
    fixture.press(button)
    fixture.notice.withdrawUndo()
    fixture.layout()
    #expect(fixture.switches.undone == [])
    #expect(fixture.buttons.isEmpty)
    // The words stay until their time is up, and the time is the one started with the notice.
    #expect(try await fixture.requestedWaits(1) == [.seconds(8)])
    try await fixture.settle()
    #expect(fixture.notice.shown != nil)
    await fixture.waits.release(0)
    try await fixture.stays { fixture.notice.shown == nil }
  }

  @Test func with_voiceover_it_is_announced_and_stays_while_it_has_a_button() async throws {
    let fixture = try NoticeFixture()
    fixture.switches.voiceOver = true

    fixture.show(moved)
    try await fixture.settle()

    #expect(fixture.switches.announced == ["Moved to Fri, Nov 27"])
    #expect(await fixture.waits.requested.isEmpty)
    #expect(fixture.notice.shown == moved)
  }

  @Test func with_voiceover_a_notice_without_a_button_leaves_on_its_time() async throws {
    let fixture = try NoticeFixture()
    fixture.switches.voiceOver = true

    fixture.show(Notice(text: "Restored", kind: .done, undoing: nil))

    #expect(fixture.switches.announced == ["Restored"])
    #expect(try await fixture.requestedWaits(1) == [.seconds(8)])
  }

  @Test func with_voiceover_it_then_leaves_on_its_time_once_withdrawn() async throws {
    let fixture = try NoticeFixture()
    fixture.switches.voiceOver = true
    fixture.show(moved)
    try await fixture.settle()
    #expect(await fixture.waits.requested.isEmpty)

    fixture.notice.withdrawUndo()

    #expect(try await fixture.requestedWaits(1) == [.seconds(8)])
    await fixture.waits.release(0)
    try await fixture.stays { fixture.notice.shown == nil }
  }

  @Test func without_voiceover_nothing_is_announced() throws {
    let fixture = try NoticeFixture()
    fixture.show(moved)
    #expect(fixture.switches.announced.isEmpty)
  }

  @Test func undo_is_an_accessibility_action() throws {
    let fixture = try NoticeFixture()
    fixture.show(moved)
    let words = try #require(fixture.label)

    #expect(words.isAccessibilityElement)
    #expect(words.accessibilityLabel == "Moved to Fri, Nov 27")
    let action = try #require(words.accessibilityCustomActions?.first)
    #expect(words.accessibilityCustomActions?.count == 1)
    #expect(action.name == "Undo")
    #expect(action.actionHandler?(action) == true)
    #expect(fixture.switches.undone == ["op-1"])
    // Spent, as the button is.
    #expect(words.accessibilityCustomActions?.isEmpty ?? true)
  }

  @Test func a_notice_without_undo_has_no_accessibility_action() throws {
    let fixture = try NoticeFixture()
    fixture.show(Notice(text: "Restored", kind: .done, undoing: nil))
    #expect(fixture.label?.accessibilityCustomActions?.isEmpty ?? true)
  }

  @Test func the_button_is_an_accessibility_element_while_it_stands() throws {
    let fixture = try NoticeFixture()
    fixture.show(moved)
    let surface = try #require(fixture.surface)
    let button = try #require(fixture.buttons.first)
    let words = try #require(fixture.label)

    let elements = (surface.accessibilityElements ?? []).compactMap { $0 as? UIView }
    #expect(elements == [words, button])
    #expect(button.isAccessibilityElement)

    fixture.notice.withdrawUndo()
    fixture.layout()
    #expect((surface.accessibilityElements ?? []).compactMap { $0 as? UIView } == [words])
  }

  @Test func the_button_leaves_the_accessibility_elements_once_undo_is_spent() throws {
    let fixture = try NoticeFixture()
    fixture.show(moved)
    let surface = try #require(fixture.surface)
    fixture.press(try #require(fixture.buttons.first))
    #expect((surface.accessibilityElements ?? []).count == 1)
  }

  @Test func while_it_fades_after_a_dismissal_it_offers_voiceover_nothing() throws {
    let fixture = try NoticeFixture()
    fixture.show(moved)
    let surface = try #require(fixture.surface)
    let words = try #require(fixture.label)

    fixture.notice.dismiss()

    #expect(!surface.isHidden, "still fading")
    #expect((surface.accessibilityElements ?? []).isEmpty)
    #expect(words.accessibilityCustomActions?.isEmpty ?? true)
    // The next notice is read again.
    fixture.show(moved)
    #expect((surface.accessibilityElements ?? []).compactMap { $0 as? UIView } == [words, try #require(fixture.buttons.first)])
    #expect(words.accessibilityCustomActions?.map(\.name) == ["Undo"])
  }

  @Test func undo_ends_as_far_from_the_trailing_edge_as_the_words_start_from_the_leading_edge() throws {
    let fixture = try NoticeFixture()
    fixture.show(moved)
    let surface = try #require(fixture.surface)
    let label = try #require(fixture.label)
    let button = try #require(fixture.buttons.first)
    let title = try #require(descendants(of: button).compactMap { $0 as? UILabel }.first)

    let wordsInset = label.convert(label.bounds, to: surface).minX
    let titleFrame = title.convert(title.bounds, to: surface)
    let titleInset = surface.bounds.width - titleFrame.maxX

    #expect(abs(titleInset - wordsInset) <= 1.5, "words start \(wordsInset) in, the title ends \(titleInset) in")
  }

  @Test func the_button_follows_the_text_size_as_the_words_do() throws {
    let fixture = try NoticeFixture()
    fixture.host.view.traitOverrides.preferredContentSizeCategory = .accessibilityExtraExtraExtraLarge
    fixture.show(moved)
    let label = try #require(fixture.label)
    let button = try #require(fixture.buttons.first)
    let title = try #require(descendants(of: button).compactMap { $0 as? UILabel }.first)

    #expect(title.font.pointSize == label.font.pointSize)
  }

  @Test func wrapped_words_keep_the_sides_inset_from_the_top() throws {
    let fixture = try NoticeFixture()
    fixture.host.view.traitOverrides.preferredContentSizeCategory = .accessibilityExtraExtraExtraLarge
    fixture.show(Notice(text: "Not today — won’t carry over · due Fri still tracked", kind: .done, undoing: "op-1"))
    let surface = try #require(fixture.surface)
    let label = try #require(fixture.label)

    let side = label.convert(label.bounds, to: surface).minX
    #expect(label.convert(label.bounds, to: surface).minY >= side)
  }

  /// On a phone, as the web's phone notice: directly under the status bar, over the navigation bar's band, so the
  /// page's first rows (the day's title) stay uncovered.
  @Test func on_a_phone_it_sits_under_the_status_bar_and_never_over_the_keyboard() throws {
    let fixture = try NoticeFixture()
    fixture.show(moved)
    let surface = try #require(fixture.surface)
    let statusBar = fixture.window.safeAreaInsets.top

    let frame = surface.convert(surface.bounds, to: fixture.window)
    #expect(abs(frame.minY - (statusBar + 8)) <= 1, "the capsule's top is at \(frame.minY), the status bar ends at \(statusBar)")
    #expect(frame.minY >= statusBar, "not over the status bar")
    #expect(frame.minY < fixture.host.view.safeAreaLayoutGuide.layoutFrame.minY, "over the navigation bar's band")

    let keyboard = CGRect(x: 0, y: 874 - 336, width: 393, height: 336)
    #expect(!frame.intersects(keyboard))
  }

  /// A phone on its side (compact height, also where its width is regular) keeps the phone's place.
  @Test func on_a_phone_on_its_side_it_sits_under_the_top_of_the_safe_area() throws {
    let fixture = try NoticeFixture(width: 874)
    fixture.window.traitOverrides.horizontalSizeClass = .regular
    fixture.window.traitOverrides.verticalSizeClass = .compact
    fixture.show(moved)
    let surface = try #require(fixture.surface)
    let frame = surface.convert(surface.bounds, to: fixture.window)
    #expect(abs(frame.minY - (fixture.window.safeAreaInsets.top + 8)) <= 1)
  }

  /// At regular width (iPad, Mac) it stays under the navigation bar.
  @Test func at_regular_width_it_sits_under_the_navigation_bar() throws {
    let fixture = try NoticeFixture(width: 1024)
    fixture.window.traitOverrides.horizontalSizeClass = .regular
    fixture.window.traitOverrides.verticalSizeClass = .regular
    fixture.show(moved)
    let surface = try #require(fixture.surface)
    let safeTop = fixture.host.view.safeAreaLayoutGuide.layoutFrame.minY
    let frame = surface.convert(surface.bounds, to: fixture.host.view)
    #expect(safeTop >= 96)
    #expect(frame.minY == safeTop + 8)
  }

  @Test func on_a_wide_screen_it_is_capped_and_centred() throws {
    let fixture = try NoticeFixture(width: 1024)
    fixture.show(
      Notice(text: "Not today — won’t carry over · due Fri still tracked", kind: .done, undoing: "op-1"))
    let surface = try #require(fixture.surface)

    let frame = surface.convert(surface.bounds, to: fixture.host.view)

    #expect(frame.width <= 560)
    #expect(abs(frame.midX - 512) < 1)
  }

  @Test func on_a_phone_it_fits_the_width_with_a_gutter() throws {
    let fixture = try NoticeFixture()
    fixture.show(moved)
    let surface = try #require(fixture.surface)
    let frame = surface.convert(surface.bounds, to: fixture.host.view)
    #expect(frame.minX >= 8 && frame.maxX <= 393 - 8)
  }

  @Test func at_the_largest_text_size_the_words_wrap_and_the_button_stays_reachable() throws {
    let fixture = try NoticeFixture()
    fixture.host.view.traitOverrides.preferredContentSizeCategory = .accessibilityExtraExtraExtraLarge
    let long = "Not today — won’t carry over · due Fri still tracked"

    fixture.show(Notice(text: long, kind: .done, undoing: "op-1"))
    let surface = try #require(fixture.surface)
    let label = try #require(fixture.label)
    let button = try #require(fixture.buttons.first)

    #expect(label.numberOfLines == 0)
    let needed = label.sizeThatFits(CGSize(width: label.bounds.width, height: .greatestFiniteMagnitude)).height
    #expect(label.bounds.height >= needed.rounded(.down))
    #expect(label.bounds.width > 0)
    #expect(surface.bounds.contains(button.convert(button.bounds, to: surface)))
    #expect(button.bounds.height >= 44)
    let frame = surface.convert(surface.bounds, to: fixture.host.view)
    #expect(frame.minX >= 0 && frame.maxX <= 393)
  }

  @Test func touches_outside_the_surface_pass_through_to_the_page() throws {
    let fixture = try NoticeFixture()
    fixture.show(moved)
    let surface = try #require(fixture.surface)
    let inside = surface.convert(CGPoint(x: surface.bounds.midX, y: surface.bounds.midY), to: fixture.notice)

    #expect(fixture.notice.hitTest(inside, with: nil) != nil)
    #expect(fixture.notice.hitTest(CGPoint(x: 200, y: 600), with: nil) == nil)
    #expect(fixture.notice.hitTest(CGPoint(x: 10, y: 10), with: nil) == nil)
  }

  @Test func it_never_takes_the_keyboard_from_the_page() throws {
    let fixture = try NoticeFixture()
    #expect(fixture.field.becomeFirstResponder())

    fixture.show(moved)
    #expect(fixture.field.isFirstResponder)
    fixture.press(try #require(fixture.buttons.first))
    #expect(fixture.field.isFirstResponder)
    fixture.notice.dismiss()
    #expect(fixture.field.isFirstResponder)
  }
}
