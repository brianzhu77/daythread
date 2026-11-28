import DaythreadCore
import DaythreadSync
import Foundation
import Synchronization
import UIKit
import XCTest

@testable import Daythread
import DaythreadEditor
@testable import DaythreadUI

/// How typing feels on a long page (`native-phase-1.md` §10.7): the time from a keystroke to the list having laid
/// itself out again, for 50 characters typed into the 150th line of a page of 300, with the engine and a store on
/// disk real and a server that never answers, so no save's answer lands while it is measured. The same on a page of
/// 10 lines says what the page's length costs.
///
/// Each test types five runs and prints each run's time per keystroke and their median. Between keystrokes the
/// engine's state with the last one is drawn, as between his; the time to that is printed too, and not budgeted.
/// The budget holds only on the machine it was measured on: with `DAYTHREAD_FEEL_BUDGET=1` given to the test runner
/// (`TEST_RUNNER_DAYTHREAD_FEEL_BUDGET=1 xcodebuild test …`), a median over one and a half times the one measured
/// fails; otherwise the numbers are only printed, since CI's machines are slower and vary.
@MainActor
final class TypingFeelTests: XCTestCase {
  /// The medians measured on the machine that set the budget (Apple silicon, the iPhone 17 simulator on iOS 26.5,
  /// a Debug build), in milliseconds per keystroke: the median of five runs of this test, 2026-11-26.
  private static let measuredMedian = (longPage: 7.040, shortPage: 2.671)
  private static let keystrokes = 50
  private static let runs = 5
  /// Words and spaces, so the line's text view breaks and wraps them as it would his.
  private static let typing = Array(" and then")
  private static let today = LocalDate("2026-11-25")!

  private var storeURL: URL?
  private var server: TestServer?
  /// Beats for the whole test, so a wait sees a stall that began in the one before it.
  private var heartbeat: Heartbeat?
  /// What each keystroke's calls and wait covered, with the clock, so a held main thread is named by what it was in.
  private var spans: [CallSpan] = []

  /// The signal handler that was in place before this test's, put back at tear-down.
  private var previousAction = sigaction()

  /// The handler that prints a held main thread's stack is installed for each test and the main thread's identity
  /// kept for the heartbeat to signal; set-up runs on the main thread.
  override func setUp() async throws {
    StackDump.mainThread.store(UInt(bitPattern: pthread_self()), ordering: .relaxed)
    var action = sigaction()
    action.__sigaction_u.__sa_handler = StackDump.handler
    sigemptyset(&action.sa_mask)
    sigaction(SIGUSR1, &action, &previousAction)
    heartbeat = Heartbeat()
  }

  /// The server is never released: once the engine's save of what was typed is waiting on it, the engine touches the
  /// store no more, and the store goes.
  override func tearDown() async throws {
    heartbeat?.stop()
    sigaction(SIGUSR1, &previousAction, nil)
    await server?.callHeld()
    if let storeURL {
      for suffix in ["", "-shm", "-wal"] {
        try? FileManager.default.removeItem(at: URL(fileURLWithPath: storeURL.path + suffix))
      }
    }
  }

  func test_typing_into_the_150th_line_of_300() async throws {
    let median = try await measureTyping(lines: 300, into: 150)
    try checkBudget(median, against: Self.measuredMedian.longPage)
  }

  func test_typing_into_the_5th_line_of_10() async throws {
    let median = try await measureTyping(lines: 10, into: 5)
    try checkBudget(median, against: Self.measuredMedian.shortPage)
  }

  /// The wait between keystrokes gives the state its time on the main actor, where the model receives it: a main
  /// thread stalled by something else (on CI, the keyboard's predictions answered more than a minute late while the
  /// whole app logged nothing for 36 s) is no state arriving late. Here the main thread is stalled past the wait's
  /// deadline while the state is on its way, as the model's would be.
  ///
  /// It fails a wait that counts the clock only because the main actor runs its jobs in the order they were queued:
  /// the wait's wake-up, queued 1 ms into the stall, runs before the state's delivery, queued at 200 ms, and finds
  /// the deadline gone. With the jobs taken in another order the state would be seen first and the old wait pass too.
  func test_a_main_thread_stalled_past_the_deadline_is_not_a_state_that_came_late() async throws {
    let state = Arrival()
    // Runs once the wait first sleeps, so the wait's own wake-up is queued behind it, before the state's.
    Task { Self.stallTheMainThread(for: .milliseconds(1_500)) }
    state.arrive(after: .milliseconds(200))
    try await until("the state reached the screen", deadline: .seconds(1)) { state.arrived }
  }

  /// The wait forgives a stall, not a late state: with the main thread free, a state that comes after the deadline
  /// fails the wait, and the message says it came late.
  func test_a_state_that_comes_after_the_deadline_fails_the_wait() async throws {
    let state = Arrival()
    state.arrive(after: .seconds(2))
    let failure = try await wait("the state reached the screen", deadline: .seconds(1)) { state.arrived }
    let message = try XCTUnwrap(failure, "a state 2 s late against a deadline of 1 s fails the wait")
    XCTAssertTrue(message.contains("ended by the deadline"), message)
    XCTAssertTrue(message.contains("it arrived late"), message)
    XCTAssertTrue(message.contains("s by the clock)"), "the clock's time beside the main thread's: \(message)")
  }

  /// A main thread that runs in chunks longer than a turn counts towards the deadline slowly; the wait still ends by
  /// the clock, says so, and does not wait a further two minutes for the state.
  func test_a_main_thread_busy_in_long_chunks_ends_the_wait_by_the_hard_stop() async throws {
    let busy = Task {
      while !Task.isCancelled {
        Self.stallTheMainThread(for: .milliseconds(300))
        try? await Task.sleep(nanoseconds: 1_000_000)
      }
    }
    defer { busy.cancel() }
    let clock = ContinuousClock()
    let started = clock.now
    let failure = try await wait("the state reached the screen", deadline: .seconds(30), hardStop: .seconds(2)) {
      false
    }
    let message = try XCTUnwrap(failure, "a state that never comes fails the wait")
    XCTAssertTrue(message.contains("ended by the hard stop of 2.0 s by the clock"), message)
    XCTAssertLessThan(clock.now - started, .seconds(10), "no further wait after the hard stop: \(message)")
  }

  /// A main thread held for long while a thread beside it ran is the app's or the test's own doing: the state that
  /// came after it is not forgiven silently. A whole process that stopped holds both, which a test cannot bring
  /// about from inside the process; that case is covered only by `outcomeOfMainStall`, tested below. On a machine
  /// that does not hold the budget (CI) the wait passes and warns: the stall there is not the app's to answer for.
  func test_a_main_thread_held_alone_warns_where_the_budget_is_not_enforced() async throws {
    var warnings: [String] = []
    let failure = try await waitThroughAStall(budgetEnforced: false) { warnings.append($0) }
    XCTAssertNil(failure, "the budget is not enforced: the wait passes")
    XCTAssertEqual(warnings.count, 1, "\(warnings)")
    let warning = try XCTUnwrap(warnings.first, "and says what it found")
    XCTAssertTrue(warning.hasPrefix("TypingFeel: main thread held"), warning)
    XCTAssertTrue(warning.contains("the main thread alone was held for"), warning)
    XCTAssertTrue(warning.contains("while waiting for the state after keystroke 1 of run 1"), warning)
  }

  func test_a_main_thread_held_alone_fails_a_wait_whose_state_arrived_where_the_budget_is_enforced() async throws {
    var warnings: [String] = []
    let failure = try await waitThroughAStall(budgetEnforced: true) { warnings.append($0) }
    let message = try XCTUnwrap(failure, "the main thread held alone for 1.5 s, past a limit of 1 s")
    XCTAssertTrue(message.contains("the main thread alone was held for"), message)
    XCTAssertTrue(message.contains("while waiting for the state after keystroke 1 of run 1"), message)
    XCTAssertEqual(warnings, [], "a failure is not also a warning")
  }

  /// Holds the main thread for 1.5 s while the state is on its way, and waits for it; skips when the machine itself
  /// stalled.
  private func waitThroughAStall(budgetEnforced: Bool, warn: @escaping (String) -> Void) async throws -> String? {
    let state = Arrival()
    let besideLimit = Duration.milliseconds(500)
    let started = ContinuousClock.now
    Task { Self.stallTheMainThread(for: .milliseconds(1_500)) }
    state.arrive(after: .milliseconds(200))
    let failure = try await wait(
      "the state reached the screen", deadline: .seconds(1), mainHeldLimit: .seconds(1), besideLimit: besideLimit,
      budgetEnforced: budgetEnforced, warn: warn, after: (index: 1, run: 1)
    ) { state.arrived }
    // On a loaded machine the heartbeat itself can miss its beats; the two cases cannot then be told apart here.
    let besideStall = try XCTUnwrap(heartbeat).longestStall(since: started)
    if besideStall > besideLimit {
      throw XCTSkip(
        "the machine was too loaded to tell a held main thread from a stopped process: the thread beside it stalled "
          + "for \(Self.seconds(besideStall)) s, past the \(Self.seconds(besideLimit)) s limit")
    }
    return failure
  }

  func test_the_rule_for_a_main_thread_held_alone_fails_warns_or_says_nothing() {
    let limits = (main: Duration.seconds(10), beside: Duration.seconds(1))
    func outcome(main: Duration, beside: Duration, enforced: Bool) -> MainStallOutcome {
      Self.outcomeOfMainStall(main: main, beside: beside, limits: limits, budgetEnforced: enforced)
    }
    XCTAssertEqual(outcome(main: .seconds(34), beside: .milliseconds(500), enforced: true), .fail)
    XCTAssertEqual(outcome(main: .seconds(34), beside: .milliseconds(500), enforced: false), .warn)
    XCTAssertEqual(outcome(main: .seconds(34), beside: .seconds(34), enforced: true), .nothing, "the process stopped")
    XCTAssertEqual(outcome(main: .seconds(34), beside: .seconds(34), enforced: false), .nothing, "the process stopped")
    XCTAssertEqual(outcome(main: .seconds(5), beside: .zero, enforced: true), .nothing, "a short stall")
    XCTAssertEqual(outcome(main: .seconds(5), beside: .zero, enforced: false), .nothing, "a short stall")
  }

  func test_a_stall_is_named_by_what_the_main_thread_was_doing() {
    let base = ContinuousClock.now
    func at(_ milliseconds: Int) -> ContinuousClock.Instant { base.advanced(by: .milliseconds(milliseconds)) }
    // Keystroke 3 of run 2: insertText 0-40 ms, layout 40-90, the wait 90-1,090, the layout after it 1,090-1,100.
    let spans = [
      CallSpan(place: .insertText, keystroke: 3, run: 2, start: at(0), end: at(40)),
      CallSpan(place: .layout, keystroke: 3, run: 2, start: at(40), end: at(90)),
      CallSpan(place: .wait, keystroke: 3, run: 2, start: at(90), end: at(1_090)),
      CallSpan(place: .layout, keystroke: 3, run: 2, start: at(1_090), end: at(1_100)),
    ]
    func named(_ from: Int, _ to: Int) -> String { Self.placesOfStall(from: at(from), to: at(to), in: spans) }

    XCTAssertEqual(
      named(5, 35), "inside insertText of keystroke 3 of run 2 (the call took 0.040 s, 0.030 s of the stall in it)")
    XCTAssertEqual(
      named(50, 80),
      "inside the list's layout of keystroke 3 of run 2 (the call took 0.050 s, 0.030 s of the stall in it)")
    XCTAssertEqual(
      named(200, 900),
      "while waiting for the state after keystroke 3 of run 2 (the wait took 1.000 s, 0.700 s of the stall in it)")
    XCTAssertEqual(
      named(1_095, 1_099),
      "inside the list's layout of keystroke 3 of run 2 (the call took 0.010 s, 0.004 s of the stall in it)")
    XCTAssertEqual(
      named(20, 60),
      "inside insertText of keystroke 3 of run 2 (the call took 0.040 s, 0.020 s of the stall in it) and "
        + "inside the list's layout of keystroke 3 of run 2 (the call took 0.050 s, 0.020 s of the stall in it)",
      "a stall across two calls names each with its share")
    XCTAssertEqual(named(2_000, 2_500), "outside every call the test recorded (the setup, or between keystrokes)")
  }

  func test_a_wait_with_no_stall_records_nothing() async throws {
    let state = Arrival()
    state.arrive(after: .milliseconds(100))
    var warnings: [String] = []
    let failure = try await wait(
      "the state reached the screen", deadline: .seconds(5), mainHeldLimit: .seconds(1), besideLimit: .milliseconds(500),
      warn: { warnings.append($0) }
    ) { state.arrived }
    XCTAssertNil(failure)
    XCTAssertEqual(warnings, [], "no warning was printed")
  }

  /// A call that takes long is a stall too, though no wait sees it: the call is one stretch of the main thread. It is
  /// held alone when the heartbeat beside it ran through it, and reported as the wait's stall is.
  func test_a_long_call_held_alone_warns_or_fails_and_is_named() throws {
    let base = ContinuousClock.now
    let limits = (main: Duration.seconds(10), beside: Duration.seconds(1))
    let insert = CallSpan(
      place: .insertText, keystroke: 4, run: 1, start: base, end: base.advanced(by: .seconds(34)))
    let layout = CallSpan(
      place: .layout, keystroke: 4, run: 1, start: base, end: base.advanced(by: .seconds(12)))

    let warned = try XCTUnwrap(
      Self.stallOfCall(insert, beside: .milliseconds(20), limits: limits, budgetEnforced: false))
    XCTAssertEqual(warned.outcome, .warn)
    XCTAssertTrue(
      warned.message.hasPrefix("inside insertText of keystroke 4 of run 1, which took 34.0 s"), warned.message)
    let failed = try XCTUnwrap(
      Self.stallOfCall(insert, beside: .milliseconds(20), limits: limits, budgetEnforced: true))
    XCTAssertEqual(failed.outcome, .fail)
    XCTAssertEqual(failed.message, warned.message)
    let inLayout = try XCTUnwrap(
      Self.stallOfCall(layout, beside: .zero, limits: limits, budgetEnforced: true))
    XCTAssertTrue(inLayout.message.hasPrefix("inside the list's layout of keystroke 4 of run 1, which took 12.0 s"))

    let short = CallSpan(place: .insertText, keystroke: 4, run: 1, start: base, end: base.advanced(by: .milliseconds(40)))
    XCTAssertNil(Self.stallOfCall(short, beside: .zero, limits: limits, budgetEnforced: true), "a short call")
    XCTAssertNil(
      Self.stallOfCall(insert, beside: .seconds(30), limits: limits, budgetEnforced: true), "the process stopped")
  }

  /// A main thread that has not answered for longer than the threshold has its stack printed, once, by a signal sent
  /// to it from the heartbeat's thread. The stack's text is not asserted.
  func test_a_main_thread_held_past_the_threshold_has_its_stack_printed_once() async throws {
    let before = StackDump.count.load(ordering: .relaxed)
    // The test's own heartbeat stands in for the one of set-up: two would each print the stack.
    await heartbeat?.stop()
    heartbeat = Heartbeat(stackAfter: .seconds(1))
    Task { Self.stallTheMainThread(for: .seconds(6)) }
    // Runs once the stall is over: the main actor takes the stall's job first.
    try await Task.sleep(nanoseconds: 10_000_000)
    XCTAssertEqual(StackDump.count.load(ordering: .relaxed) - before, 1, "the stack was printed once, not more")
  }

  /// A signal that arrives when no heartbeat is armed (one that was sent as its test ended) prints nothing, and the
  /// process lives: the handler stays installed for the life of the process.
  func test_a_signal_with_no_heartbeat_armed_prints_nothing_and_the_process_lives() async throws {
    await heartbeat?.stop()
    let before = StackDump.count.load(ordering: .relaxed)
    pthread_kill(pthread_self(), SIGUSR1)
    XCTAssertEqual(StackDump.count.load(ordering: .relaxed), before, "nothing printed while nothing is armed")
  }

  @MainActor private final class Arrival {
    var arrived = false

    /// Arrives on the main actor after `delay`, queued from a thread off it.
    func arrive(after delay: Duration) {
      let nanoseconds = UInt64(delay / .nanoseconds(1))
      Task.detached { [self] in
        try? await Task.sleep(nanoseconds: nanoseconds)
        await MainActor.run { self.arrived = true }
      }
    }
  }

  private static func stallTheMainThread(for duration: Duration) {
    let clock = ContinuousClock()
    let end = clock.now.advanced(by: duration)
    while clock.now < end {}
  }

  /// The strip's cost on a large workspace (`native-phase-1.md` §12.6): 3,000 to-dos on 300 day pages of 10 rows, 200
  /// chips, 100 to-dos set aside and 100 due with no row today. Prints the time to build the index and the time of
  /// the facts of today read from it, per run and their medians; not budgeted.
  func test_the_strips_facts_on_a_large_workspace() throws {
    let todayRows = (1...10).map { Self.todoRow("line-\($0)", "todo-\($0)", on: Self.today, words: Self.words(of: $0)) }
    let workspace = try Self.workspace(
      todayLines: todayRows, todayTasks: (1...10).map { Self.todo("todo-\($0)") }, pastRows: 10, chips: 200,
      chipsToday: 3)
    XCTAssertEqual(workspace.pages.count, 300)
    XCTAssertEqual(workspace.tasks.count, 3_000)

    let clock = ContinuousClock()
    var indexRuns: [Double] = []
    var factsRuns: [Double] = []
    var facts = DayFacts.none
    for _ in 0..<Self.runs {
      var index: TodoIndex?
      let indexTime = clock.measure { index = TodoIndex(workspace) }
      let built = try XCTUnwrap(index)
      let factsTime = clock.measure {
        facts = DayFacts.of(day: Self.today, in: workspace, index: built, today: Self.today)
      }
      indexRuns.append(indexTime / .milliseconds(1))
      factsRuns.append(factsTime / .milliseconds(1))
      print("TypingFeel: facts index \(Self.shown(indexRuns.suffix(1))) ms, facts \(Self.shown(factsRuns.suffix(1))) ms")
    }
    print(
      "TypingFeel: facts index median \(Self.shown([Self.median(indexRuns)])) ms, facts median",
      "\(Self.shown([Self.median(factsRuns)])) ms, of 3,000 to-dos on 300 pages")
    XCTAssertEqual(facts.notToday?.rows.count, 100, "the to-dos set aside")
    XCTAssertEqual(facts.dueSoon.count, 100, "the to-dos due with no row today")
    XCTAssertNotNil(facts.events, "the events of today")
  }

  /// The fixture holds the strip the typing tests are to type under: 100 set aside, 100 due, and events today.
  private static func expectTheStrip(of workspace: Workspace) {
    let facts = DayFacts.of(day: today, in: workspace, index: TodoIndex(workspace), today: today)
    XCTAssertEqual(facts.notToday?.rows.count, 100, "the to-dos set aside")
    XCTAssertEqual(facts.dueSoon.count, 100, "the to-dos due with no row today")
    XCTAssertNotNil(facts.events, "the events of today")
  }

  /// Whether the machine is the one the budget was measured on (`DAYTHREAD_FEEL_BUDGET=1`): the budget and a main
  /// thread held alone fail only there.
  private static var budgetIsEnforced: Bool { ProcessInfo.processInfo.environment["DAYTHREAD_FEEL_BUDGET"] == "1" }

  private func checkBudget(_ median: Double, against measured: Double) throws {
    guard Self.budgetIsEnforced else { return }
    let budget = try XCTUnwrap(measured > 0 ? measured * 1.5 : nil, "no median measured yet to hold the budget to")
    XCTAssertLessThanOrEqual(median, budget, "ms per keystroke, against one and a half times the \(measured) measured")
  }

  /// Applies the rule for a main thread held alone (`outcomeOfMainStall`) to each call's own length against the
  /// heartbeat's longest stall while it ran: it fails where the budget is enforced, otherwise prints a warning line.
  /// A failure ends the test, as a failed wait does.
  private func checkForHeldMainThread(in calls: [CallSpan]) throws {
    guard let heartbeat else { return }
    for call in calls {
      let beside = heartbeat.longestStall(since: call.start, until: call.end)
      guard
        let stall = Self.stallOfCall(
          call, beside: beside, limits: (main: .seconds(10), beside: .seconds(1)), budgetEnforced: Self.budgetIsEnforced)
      else { continue }
      switch stall.outcome {
      case .fail:
        XCTFail(stall.message)
        throw WaitFailed(message: stall.message)
      case .warn, .nothing:
        print("TypingFeel: main thread held: \(stall.message)")
      }
    }
  }

  /// Types `keystrokes` characters at the end of line `target` (1-based) of a page of `count` lines, `runs` times, and
  /// returns the median of the runs' milliseconds per keystroke to the list laid out.
  private func measureTyping(lines count: Int, into target: Int) async throws -> Double {
    let (model, engine) = try await model(page: count)
    let published = Published(following: engine.states, page: Self.today)
    defer { published.stop() }
    let screen = DayViewController(model: model)
    let window = try feelWindow()
    window.rootViewController = UINavigationController(rootViewController: screen)
    window.makeKeyAndVisible()
    defer { window.isHidden = true }
    screen.updatePropertiesIfNeeded()
    window.layoutIfNeeded()

    let list = try XCTUnwrap(screen.list)
    let editor = try XCTUnwrap(screen.children.compactMap { $0 as? DocumentViewController }.first)
    XCTAssertEqual(editor.today, Self.today, "the rows' facts are read, as on the day screen")
    list.scrollToItem(at: IndexPath(item: target - 1, section: 0), at: .centeredVertically, animated: false)
    window.layoutIfNeeded()
    let words = Self.words(of: target)
    let line = try XCTUnwrap(
      list.visibleCells.lazy.compactMap { Self.textView(in: $0) }.first { $0.text == words }, "line \(target)")
    XCTAssertTrue(line.becomeFirstResponder())
    window.layoutIfNeeded()

    var runs: [Double] = []
    var drawnRuns: [Double] = []
    var typed = words
    var stored = try XCTUnwrap(model.workspace?.dayPage(Self.today)?.document.utf8.count)
    let clock = ContinuousClock()
    for runIndex in 0..<Self.runs {
      line.selectedRange = NSRange(location: (line.text as NSString).length, length: 0)
      var laidOut = Duration.zero
      var drawn = Duration.zero
      for index in 0..<Self.keystrokes {
        let character = String(Self.typing[index % Self.typing.count])
        let start = clock.now
        line.insertText(character)
        // The one clock read added inside the timed span: it splits the call from the layout for the stall's naming.
        let inserted = clock.now
        window.layoutIfNeeded()
        let laidOutAt = clock.now
        laidOut += laidOutAt - start
        // The spans are written once the keystroke's state has arrived, not between the call and the wait: appending
        // there read 0.5 to 1 ms a keystroke higher on both pages. A wait's stall begins inside the wait, so the
        // keystroke's own calls are not needed while it runs; the wait writes its own span.
        let keystroke = (index: index + 1, run: runIndex + 1)
        typed += character
        // As between his keystrokes, the engine's state with this one is drawn before the next. Each character typed
        // is one byte of the document; its length is read, not its text searched, so the wait costs the main actor
        // nothing that would be counted against the app.
        stored += 1
        let expected = stored
        try await until(
          "the engine's state reached the screen", after: keystroke,
          held: {
            let length = model.workspace?.dayPage(Self.today)?.document.utf8.count
            let state = model.state
            return "the page's document \(length.map(String.init) ?? "absent") bytes long, \(expected) expected; "
              + "state number \(state.published), \(state.drafts.count) drafts \(state.drafts.map { "\($0.state)" }); "
              + "keystroke \(index + 1) of run \(runIndex + 1); the engine had published \(published.last)"
          }
        ) { model.workspace?.dayPage(Self.today)?.document.utf8.count == expected }
        let waitedAt = clock.now
        window.layoutIfNeeded()
        let drawnAt = clock.now
        drawn += drawnAt - start
        // Each call is a stretch of the main thread too: one held for long fails or warns as a wait's stall does. This
        // runs after the timed span ended.
        let calls = [
          CallSpan(place: .insertText, keystroke: keystroke.index, run: keystroke.run, start: start, end: inserted),
          CallSpan(place: .layout, keystroke: keystroke.index, run: keystroke.run, start: inserted, end: laidOutAt),
          CallSpan(place: .layout, keystroke: keystroke.index, run: keystroke.run, start: waitedAt, end: drawnAt),
        ]
        spans += calls
        try checkForHeldMainThread(in: calls)
      }
      runs.append(laidOut / .milliseconds(1) / Double(Self.keystrokes))
      drawnRuns.append(drawn / .milliseconds(1) / Double(Self.keystrokes))
    }
    XCTAssertEqual(line.text, typed, "every character typed is in the line")

    let median = Self.median(runs)
    print(
      "TypingFeel: \(count) lines, line \(target), ms per keystroke to the list laid out: runs \(Self.shown(runs)),",
      "median \(Self.shown([median])); to the engine's state drawn (not budgeted): runs \(Self.shown(drawnRuns)),",
      "median \(Self.shown([Self.median(drawnRuns)]))")
    window.endEditing(true)
    return median
  }

  private static func median(_ values: [Double]) -> Double { values.sorted()[values.count / 2] }

  private static func shown(_ values: [Double]) -> String {
    values.map { String(format: "%.3f", $0) }.joined(separator: " ")
  }

  /// Waits, a millisecond at a time, for `condition`, the main actor's other work running meanwhile; fails after
  /// thirty seconds of the main thread's time. The wait is long because it is not what is measured: on CI's machines
  /// one keystroke's state has taken more than two seconds to be drawn on the 300-line page, which failed the run
  /// without any defect.
  ///
  /// The main thread's time, not the clock's: the model receives a state on the main actor, and a main thread held
  /// by something else (on CI the app once logged nothing for 36 s while the keyboard's predictions answered over a
  /// minute late) gives no state a chance to arrive. Each turn of the loop counts at most `turn` towards the deadline,
  /// so such a stall costs the wait one turn; the drawn time still counts all of it. Two limits keep that forgiveness
  /// honest (see `wait`): a hard stop by the clock, and a failure when the main thread alone was held for long.
  ///
  /// A failure says what the model held when it gave up (`held`) and the longest stalls of the main thread and of a
  /// thread beside it, then, unless the hard stop ended the wait, waits a further two minutes and reads again, so the
  /// log tells a state that came late from one that did not come. A failed wait records the failure and throws, which
  /// ends the test: the keystrokes after it are not measured.
  private func until(
    _ what: String, deadline patience: Duration = .seconds(30), after keystroke: (index: Int, run: Int)? = nil,
    held: () -> String = { "" }, _ condition: () -> Bool
  ) async throws {
    guard let message = try await wait(what, deadline: patience, after: keystroke, held: held, condition) else {
      return
    }
    XCTFail(message)
    // The test ends here: another wait after a failed one would cost the same again for every keystroke left.
    throw WaitFailed(message: message)
  }

  /// The wait `until` makes, with what it found: nil when `condition` held in time, else the failure's words.
  ///
  /// `hardStop`, by the clock: a main thread that runs in chunks longer than a turn counts towards the deadline
  /// slowly, and without it one wait for a state that never comes could outlast CI's job. `mainHeldLimit` and
  /// `besideLimit`: a wait whose condition held still fails when the main thread alone was held that long while the
  /// heartbeat beside it ran (`outcomeOfMainStall`): that fails the wait where the budget is enforced and is otherwise
  /// printed to `warn` as a line beginning `TypingFeel: main thread held`; only a stop of the whole process is
  /// forgiven silently. Either names what the main thread was doing during the stall, from `spans` and, for a wait
  /// after a keystroke (`keystroke`), this wait's own span: a stall the wait sees is inside the wait, where the body
  /// is suspended and other work on the main thread held it. The calls of each keystroke (`insertText`, the list's
  /// layout, the layout after the wait) are checked on their own, after the timed span (`checkForHeldMainThread`),
  /// since no wait sees a stall inside them. A main thread that does not answer for 5 s has its stack printed once
  /// (`StackDump`, under the line `TypingFeel: main thread stack while held`), which says what held it.
  private func wait(
    _ what: String, deadline patience: Duration = .seconds(30), hardStop: Duration = .seconds(300),
    mainHeldLimit: Duration = .seconds(10), besideLimit: Duration = .seconds(1),
    budgetEnforced: Bool = TypingFeelTests.budgetIsEnforced, warn: (String) -> Void = { print($0) },
    after keystroke: (index: Int, run: Int)? = nil, held: () -> String = { "" }, _ condition: () -> Bool
  ) async throws -> String? {
    let clock = ContinuousClock()
    let started = clock.now
    let stopAt = started.advanced(by: hardStop)
    let turn = Duration.milliseconds(100)
    var waited = Duration.zero
    var longestStall = Duration.zero
    var longestStallAt = (start: started, end: started)
    var lastTurn = started
    while !condition(), waited < patience, clock.now < stopAt {
      try await Task.sleep(nanoseconds: 1_000_000)
      let now = clock.now
      if now - lastTurn > longestStall {
        longestStall = now - lastTurn
        longestStallAt = (lastTurn, now)
      }
      waited += min(now - lastTurn, turn)
      lastTurn = now
    }
    if let keystroke {
      spans.append(CallSpan(place: .wait, keystroke: keystroke.index, run: keystroke.run, start: started, end: clock.now))
    }
    let besideStall = heartbeat?.longestStall(since: started)
    let stalls =
      "the main thread stalled for up to \(Self.seconds(longestStall)) s and a thread beside it for up to "
      + "\(besideStall.map(Self.seconds) ?? "an unknown") s"
    if condition() {
      guard let besideStall else { return nil }
      let outcome = Self.outcomeOfMainStall(
        main: longestStall, beside: besideStall, limits: (main: mainHeldLimit, beside: besideLimit),
        budgetEnforced: budgetEnforced)
      guard outcome != .nothing else { return nil }
      let message =
        "\(what): there, but the main thread alone was held for \(Self.seconds(longestStall)) s while a thread "
        + "beside it stalled for no more than \(Self.seconds(besideStall)) s: the app's or the test's own doing, not a "
        + "stopped process; the main thread was: "
        + Self.placesOfStall(from: longestStallAt.start, to: longestStallAt.end, in: spans)
      if outcome == .fail { return message }
      warn("TypingFeel: main thread held: \(message)")
      return nil
    }
    let gaveUp = clock.now
    let endedBy =
      waited < patience ? "the hard stop of \(Self.seconds(hardStop)) s by the clock" : "the deadline"
    let heldThen = "\(held()); \(stalls)"
    let outcome: String
    if waited < patience {
      outcome = "not waited for further after the hard stop"
    } else {
      let furtherDeadline = gaveUp.advanced(by: .seconds(120))
      while !condition(), clock.now < furtherDeadline {
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      outcome =
        condition()
        ? "it arrived late, \(Self.seconds(clock.now - gaveUp)) s after the first wait ended"
        : "it had still not arrived after a further \(Self.seconds(clock.now - gaveUp)) s; the model then held \(held())"
    }
    return "\(what): not there after \(Self.seconds(waited)) s of the main thread's time "
      + "(\(Self.seconds(gaveUp - started)) s by the clock), ended by \(endedBy); the model held \(heldThen); \(outcome)"
  }

  /// What a wait that found its state does about the main thread's longest stall: a main thread held for
  /// `limits.main` or more while a thread beside it never stalled more than `limits.beside` is held alone (when both
  /// stalled, the whole process stopped, and nothing is said). Held alone, it fails where the budget is enforced and
  /// only warns elsewhere.
  private enum MainStallOutcome { case fail, warn, nothing }

  private static func outcomeOfMainStall(
    main: Duration, beside: Duration, limits: (main: Duration, beside: Duration), budgetEnforced: Bool
  ) -> MainStallOutcome {
    guard main >= limits.main, beside <= limits.beside else { return .nothing }
    return budgetEnforced ? .fail : .warn
  }

  /// What a signal to the main thread does: counts itself, writes a line and the thread's stack to standard error.
  /// Nothing but calls that are safe in a signal handler, no Swift allocation and no locks, and nothing captured: the
  /// handler reads only these file-scope atomics.
  private enum StackDump {
    static let count = Atomic<Int>(0)
    /// The main thread's `pthread_t`, as an integer, kept at set-up.
    static let mainThread = Atomic<UInt>(0)

    static let handler: @convention(c) (Int32) -> Void = { _ in
      StackDump.count.add(1, ordering: .relaxed)
      let line: StaticString = "TypingFeel: main thread stack while held\n"
      write(2, line.utf8Start, line.utf8CodeUnitCount)
      withUnsafeTemporaryAllocation(of: UnsafeMutableRawPointer?.self, capacity: 128) { frames in
        let count = backtrace(frames.baseAddress, 128)
        backtrace_symbols_fd(frames.baseAddress, count, 2)
      }
    }
  }

  /// A stretch of the test body's own time: what it was in, for which keystroke of which run, and when by the clock.
  private struct CallSpan {
    enum Place { case insertText, layout, wait }
    let place: Place
    let keystroke: Int
    let run: Int
    let start: ContinuousClock.Instant
    let end: ContinuousClock.Instant
  }

  /// What a call that took long says: it is one stretch of the main thread, so its own length is the stall, held alone
  /// when the heartbeat `beside` it ran through it (`outcomeOfMainStall`). Nil when nothing is to be said. The waits
  /// are not checked here: they find their own stall by turns (`wait`).
  private static func stallOfCall(
    _ call: CallSpan, beside: Duration, limits: (main: Duration, beside: Duration), budgetEnforced: Bool
  ) -> (outcome: MainStallOutcome, message: String)? {
    let length = call.end - call.start
    let outcome = outcomeOfMainStall(main: length, beside: beside, limits: limits, budgetEnforced: budgetEnforced)
    guard outcome != .nothing else { return nil }
    let place =
      call.place == .insertText ? "inside insertText" : call.place == .layout ? "inside the list's layout" : "in the wait"
    return (
      outcome,
      "\(place) of keystroke \(call.keystroke) of run \(call.run), which took \(seconds(length)) s while a thread "
        + "beside it stalled for no more than \(seconds(beside)) s: the app's or the test's own doing, not a stopped "
        + "process"
    )
  }

  /// What the main thread was doing during a stall from `from` to `to`: each span the stall overlaps, with the span's
  /// own length and the share of the stall inside it. The wait is the body suspended, so the main thread was held by
  /// other work on it; its stack, printed while it was held (`StackDump`), says by what.
  private static func placesOfStall(
    from: ContinuousClock.Instant, to: ContinuousClock.Instant, in spans: [CallSpan]
  ) -> String {
    let places: [String] = spans.compactMap { span in
      let share = min(to, span.end) - max(from, span.start)
      guard share > .zero else { return nil }
      let of = "keystroke \(span.keystroke) of run \(span.run)"
      let timings = "\(preciseSeconds(span.end - span.start)) s, \(preciseSeconds(share)) s of the stall in it"
      switch span.place {
      case .insertText: return "inside insertText of \(of) (the call took \(timings))"
      case .layout: return "inside the list's layout of \(of) (the call took \(timings))"
      case .wait: return "while waiting for the state after \(of) (the wait took \(timings))"
      }
    }
    return places.isEmpty
      ? "outside every call the test recorded (the setup, or between keystrokes)" : places.joined(separator: " and ")
  }

  /// Beats every 10 ms on a thread off the main one for the whole test and keeps its long gaps between beats: next to
  /// the main thread's own stalls, it tells a whole app (or simulator) that stopped from a main thread held by
  /// something.
  ///
  /// It also asks the main queue every 250 ms (one empty block, run when the main thread next takes work off its
  /// queue, never inside a timed call) and, when an ask has gone unanswered for `stackAfter`, signals the main thread
  /// once so its stack is printed (`StackDump`): the stack of a main thread held for long says what held it.
  private final class Heartbeat: Sendable {
    private struct Beats {
      var last: ContinuousClock.Instant
      var gaps: [(end: ContinuousClock.Instant, length: Duration)] = []
      /// When the main queue was last asked and has not answered; nil while it has.
      var askedAt: ContinuousClock.Instant?
      var lastAsk: ContinuousClock.Instant
      var printedStack = false
    }

    private let beats = Mutex(Beats(last: ContinuousClock.now, lastAsk: ContinuousClock.now))
    private let beating = Mutex<Task<Void, Never>?>(nil)

    init(stackAfter: Duration = .seconds(5)) {
      // The task ends at `stop`, which lets go of the beat.
      let task = Task.detached { [self] in
        while !Task.isCancelled {
          // Cancelled the moment it starts on CI's Xcode, `Task.sleep(for:)` aborts the process.
          try? await Task.sleep(nanoseconds: 10_000_000)
          let now = ContinuousClock.now
          let (ask, signal) = self.beats.withLock { beats -> (Bool, Bool) in
            // Only gaps well past a beat are kept, so the list stays short over a test of minutes.
            if now - beats.last > .milliseconds(50) { beats.gaps.append((now, now - beats.last)) }
            beats.last = now
            if let askedAt = beats.askedAt {
              guard !beats.printedStack, now - askedAt >= stackAfter else { return (false, false) }
              beats.printedStack = true
              return (false, true)
            }
            guard now - beats.lastAsk >= .milliseconds(250) else { return (false, false) }
            beats.askedAt = now
            beats.lastAsk = now
            return (true, false)
          }
          if ask {
            DispatchQueue.main.async { self.beats.withLock { $0.askedAt = nil } }
          }
          if signal, let main = pthread_t(bitPattern: StackDump.mainThread.load(ordering: .relaxed)) {
            pthread_kill(main, SIGUSR1)
          }
        }
      }
      beating.withLock { $0 = task }
    }

    /// The longest the thread went without a beat from `start` to `end` (to now when nil): a gap that began before
    /// `start` counts from it, and a gap still going counts too.
    func longestStall(since start: ContinuousClock.Instant, until end: ContinuousClock.Instant? = nil) -> Duration {
      let now = ContinuousClock.now
      let limit = end ?? now
      return beats.withLock { beats in
        (beats.gaps + [(end: now, length: now - beats.last)])
          .map { min($0.end, limit) - max($0.end - $0.length, start) }.max().map { max($0, .zero) } ?? .zero
      }
    }

    func stop() {
      beating.withLock { $0?.cancel() }
    }
  }

  /// The engine's last state, read as it is published, off the main thread: a failed wait says whether the engine had
  /// published the keystroke when the model had not drawn it.
  private final class Published: Sendable {
    private let latest = Mutex("no state")
    private let following = Mutex<Task<Void, Never>?>(nil)

    init(following states: AsyncStream<SyncState>, page day: LocalDate) {
      let task = Task.detached { [self] in
        for await state in states {
          let length = state.workspace?.dayPage(day)?.document.utf8.count
          self.latest.withLock {
            $0 = "state number \(state.published), the page's document \(length.map(String.init) ?? "absent") bytes long"
          }
        }
      }
      following.withLock { $0 = task }
    }

    var last: String { latest.withLock { $0 } }

    func stop() {
      following.withLock { $0?.cancel() }
    }
  }

  private struct WaitFailed: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
  }

  private static func preciseSeconds(_ duration: Duration) -> String {
    String(format: "%.3f", duration / .milliseconds(1) / 1_000)
  }

  private static func seconds(_ duration: Duration) -> String {
    String(format: "%.1f", duration / .milliseconds(1) / 1_000)
  }

  // MARK: The page

  private static func words(of line: Int) -> String { "Line \(line) of the day, with a few words in it" }

  private static let dayBefore = LocalDate("2026-11-24")!

  /// A line holding a to-do's row, planned on `day`.
  private static func todoRow(_ id: String, _ taskId: String, on day: LocalDate, words: String) -> String {
    #"{"id":"\#(id)","type":"task","props":{"taskId":"\#(taskId)","role":"plan","planDate":"\#(day.value)"},"content":[{"type":"text","text":"\#(words)","styles":{}}],"children":[]}"#
  }

  /// A to-do due tomorrow, so on no strip of today; `paused` sets it aside, `deadline` moves its due date.
  private static func todo(_ id: String, paused: Bool = false, deadline: LocalDate? = nil) -> JSONValue {
    .object([
      "id": .string(id), "title": .string("A to-do"), "status": .string("open"), "paused": .bool(paused),
      "version": .number("1"), "deadlineOn": .string((deadline ?? LocalDate("2026-11-26")!).value),
      "attentionOn": .null,
    ])
  }

  private static func dayPage(_ day: LocalDate, _ lines: [String]) -> JSONValue {
    .object([
      "id": .string("day:\(day.value)"), "type": .string("daily"), "date": .string(day.value),
      "title": .string(""), "document": .string("[\(lines.joined(separator: ","))]"),
    ])
  }

  /// A line holding one date chip: an event on `date`.
  private static func chipLine(_ number: Int, on date: LocalDate) -> String {
    #"{"id":"chip-\#(number)","type":"paragraph","props":{},"content":[{"type":"dateMention","props":{"eventId":"event-\#(number)","date":"\#(date.value)"}}],"children":[]}"#
  }

  /// A workspace of 3,000 to-dos on today's page (`todayLines`, with the to-dos whose rows they hold) and on the
  /// `pastRows` rows a day of the days before it, with the strip's facts on today: of the past to-dos the first 100 are
  /// set aside and the next 100 are due the day before today, so none has a row today; and `chips` lines each holding
  /// a date chip, spread over the past pages, the first `chipsToday` dated today.
  private static func workspace(
    todayLines: [String], todayTasks: [JSONValue], pastRows: Int, chips: Int, chipsToday: Int
  ) throws -> Workspace {
    var tasks = todayTasks
    var past: [(day: LocalDate, lines: [String])] = []
    var pastCount = 0
    var day = today
    while tasks.count < 3_000 {
      day = try XCTUnwrap(day.adding(days: -1))
      let rows = (0..<min(pastRows, 3_000 - tasks.count)).map { index in
        let id = "past-\(day.value)-\(index)"
        let task: JSONValue
        switch pastCount {
        case 0..<100: task = todo(id, paused: true)
        case 100..<200: task = todo(id, deadline: dayBefore)
        default: task = todo(id)
        }
        pastCount += 1
        tasks.append(task)
        return todoRow(id, id, on: day, words: "Something to do")
      }
      past.append((day, rows))
    }
    for chip in 0..<chips {
      let page = chip * past.count / chips
      past[page].lines.append(chipLine(chip, on: chip < chipsToday ? today : past[page].day))
    }
    let pages = [dayPage(today, todayLines)] + past.map { dayPage($0.day, $0.lines) }
    return try XCTUnwrap(
      Workspace(
        .object([
          "revision": .number("1"), "timezone": .string("UTC"), "pages": .array(pages), "tasks": .array(tasks),
        ])))
  }

  /// A model signed in as `one`, on a store on disk holding today's page of `count` lines, its engine past its first
  /// pass; from then on the server holds every call, saves included, and answers none.
  /// Every third line of the page (the first, the fourth, …) is a to-do due tomorrow, so its row draws a marks line;
  /// the lines typed into (the 150th, the 5th) are not. The workspace holds 3,000 to-dos in all: the rest are
  /// planned on the days before, 100 a day, so the rows' facts read an index of a workspace that size. The strip
  /// above the page is on screen too: 100 of those to-dos are set aside, 100 are due and have no row today, and the
  /// past pages hold 200 chips, 2 of them dated today.
  private func model(page count: Int) async throws -> (AppModel, SyncEngine) {
    var tasks: [JSONValue] = []
    let lines = (1...count).map { index in
      guard index % 3 == 1 else {
        return #"{"id":"line-\#(index)","type":"paragraph","props":{},"content":[{"type":"text","text":"\#(Self.words(of: index))","styles":{}}],"children":[]}"#
      }
      tasks.append(Self.todo("todo-\(index)"))
      return Self.todoRow("line-\(index)", "todo-\(index)", on: Self.today, words: Self.words(of: index))
    }
    let copy = try Self.workspace(todayLines: lines, todayTasks: tasks, pastRows: 100, chips: 200, chipsToday: 2)
    Self.expectTheStrip(of: copy)

    let url = FileManager.default.temporaryDirectory.appendingPathComponent("typing-feel-\(UUID().uuidString).store")
    storeURL = url
    let store = try SwiftDataWorkspaceStore.open(at: url)
    try await store.replace(with: copy, owner: "one")
    let server = TestServer([
      .account(Account(owner: "one", email: "one@example.com", signIn: true)),
      .workspace(.unchanged(revision: copy.revision, owner: "one")),
    ])
    self.server = server
    let tokens = MemoryTokenStore()
    try tokens.write(one)
    let engine = SyncEngine(transport: server, tokens: tokens, store: store, sleep: SyncEngine.sleep, now: { noon })
    let model = AppModel(
      engine: engine, keepsChanges: true, now: { noon }, states: nil, asksForDayDrafts: false)
    model.start()
    try await until(
      "the model signed in and showed the copy",
      held: { "phase \(model.state.phase), \(model.workspace == nil ? "no copy" : "a copy")" }
    ) { model.state.phase == .ready && model.workspace != nil }
    await engine.settled()
    await server.hold()
    return (model, engine)
  }

  private func feelWindow() throws -> UIWindow {
    let scene = try XCTUnwrap(
      UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first, "the test host has a scene")
    let window = UIWindow(windowScene: scene)
    window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
    return window
  }

  private static func textView(in view: UIView) -> UITextView? {
    if let view = view as? UITextView { return view }
    return view.subviews.lazy.compactMap { textView(in: $0) }.first
  }
}
