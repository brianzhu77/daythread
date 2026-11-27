/// What a to-do's row on a day page draws beside its words and offers, as the web decides it (`rowMarks` in
/// `src/components/row-marks.ts` and `rowMenu`), read from the workspace as drawn.
public struct RowFacts: Hashable, Sendable {
  public enum Mark: Hashable, Sendable {
    case cancelled
    /// Drawn red when `passed`: the Due date is before today.
    case dateTag(String, passed: Bool)
    /// "Since Nov 3"
    case since(String)
    /// Drawn as the `repeat` symbol; read as the name, "Repeats every week".
    case repeats(name: String)
    /// Regular width only.
    case reference
    /// "Moved to Fri 11/27"; regular width only.
    case movedTo(String)

    /// The words drawn or read.
    public var words: String {
      switch self {
      case .cancelled: "Cancelled"
      case .dateTag(let text, _): text
      case .since(let text): text
      case .repeats(let name): name
      case .reference: "Reference"
      case .movedTo(let text): text
      }
    }

    fileprivate var regularWidthOnly: Bool {
      switch self {
      case .reference, .movedTo: true
      default: false
      }
    }
  }

  /// Every mark that applies, at either width, in the order they are drawn: Cancelled, the date tag, Since, the
  /// repeat, Reference, Moved to.
  public let marks: [Mark]
  /// "Blocked by Buy paint", "Blocked by 2"; a line of its own.
  public let blockedBy: String?
  /// The reference row's `Plan for today` button is shown: every open reference row, also when the to-do is already
  /// planned today (as the web draws it; only the swipe and the menu leave the action out then).
  public let planForToday: Bool
  public let menu: RowMenu?

  /// `rowMarks` and `rowMenu` for a row. Nil for a block that is not a `task` row. The facts of a to-do the workspace
  /// does not hold are empty with no menu. Reads the block's `taskId`, `role` and `planDate` and nothing else; `index`
  /// is of `workspace`, and `pageDate` is the page's own day (nil when it is not a day page).
  public static func of(
    row block: Block, pageDate: LocalDate?, in workspace: Workspace, index: TodoIndex, today: LocalDate
  ) -> RowFacts? {
    guard block.type == "task" else { return nil }
    guard let taskId = block.props["taskId"]?.stringValue, let task = workspace.task(taskId) else {
      return RowFacts(marks: [], blockedBy: nil, planForToday: false, menu: nil)
    }
    let role = RowRole(block.props["role"])
    // The row's own plan day; the web's prop is "" when the row has none.
    let planDateText = block.props["planDate"]?.stringValue ?? ""
    let planDate = LocalDate(planDateText)
    let planned = index.plannedOn(taskId)
    let open = task.status == .open

    var marks: [Mark] = []
    if task.status == .cancelled { marks.append(.cancelled) }
    if open && task.hasDateFacts {
      // A row without a plan day is worded against today, so a reference row reads the same wherever it sits.
      let text = DateTag.text(for: task, today: today, pageDate: planDate ?? today, planned: planned)
      if !text.isEmpty { marks.append(.dateTag(text, passed: task.deadlinePassed(today: today))) }
    }
    if open, role == .plan, planDateText.hasSameCodeUnits(as: today.value),
      let since = index.carriedSince(task, today: today)
    {
      marks.append(.since("Since " + DayWords.sinceLabel(since, today: today)))
    }
    if open, let rule = index.repeatRule(of: taskId) { marks.append(.repeats(name: rule.markName)) }
    if role == .reference { marks.append(.reference) }
    // A history row: the to-do's plan moved on to a later day; the row stays as the record of where it was.
    if open, role == .plan, let planned, !planDateText.isEmpty, !planDateText.hasSameCodeUnits(as: planned.value) {
      marks.append(.movedTo("Moved to \(DayWords.shortLabel(planned))"))
    }

    return RowFacts(
      marks: marks, blockedBy: Blockers.words(index.blockers(of: taskId)),
      planForToday: role == .reference && open,
      menu: RowMenu.of(task: task, role: role, planned: planned, pageDate: pageDate, today: today))
  }

  /// The marks drawn at this width (`Reference` and `Moved to` only when `regularWidth`).
  public func marks(regularWidth: Bool) -> [Mark] {
    regularWidth ? marks : marks.filter { !$0.regularWidthOnly }
  }

  /// One line for VoiceOver, in order, comma-joined, `Blocked by` last:
  /// "Due tomorrow, Since Nov 3, Repeats every week, Blocked by Buy paint". Nil when there is nothing to say.
  public func spoken(regularWidth: Bool) -> String? {
    let words = marks(regularWidth: regularWidth).map(\.words) + [blockedBy].compactMap { $0 }
    return words.isEmpty ? nil : words.joined(separator: ", ")
  }
}
