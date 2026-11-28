/// An id as the web compares it: by code units (`===`), not by canonical equivalence as a Swift `String` does.
struct CodeUnitKey: Hashable, Sendable {
  let units: [UInt8]
  init(_ text: String) { units = Array(text.utf8) }
}

/// Anything but exactly "plan" reads as a reference (`rowRole`).
public enum RowRole: Hashable, Sendable {
  case plan, reference

  public init(_ prop: JSONValue?) {
    self = prop?.stringValue?.hasSameCodeUnits(as: "plan") == true ? .plan : .reference
  }
}

/// A row of a to-do on a live page (not in Trash, not a template, not a day's draft), as `taskRows` gives it.
public struct TaskRow: Hashable, Sendable {
  public let pageId: String
  /// The page's date when it is a day page; nil otherwise.
  public let day: LocalDate?
  public let blockId: String
  public let role: RowRole
}

/// What the rows of a workspace say about its to-dos, read once per workspace value: a keystroke that draws
/// one row never reads every page again. Build one for each workspace a screen is given, and read every row from it.
///
/// Building it parses each live page's document once, each day page's draft that a plan row could be held back by,
/// and the workspace's repeats and links. Nothing it answers reads a document again. It is a value: a caller keeps
/// it beside the workspace it was built from (for a screen, in the model that holds the workspace) and builds a new
/// one when that workspace changes.
public struct TodoIndex: Sendable {
  private var rowsByTask: [CodeUnitKey: [TaskRow]] = [:]
  private var plannedDays: [CodeUnitKey: LocalDate] = [:]
  private var repeatRules: [CodeUnitKey: RepeatRule] = [:]
  private var blockersByTask: [CodeUnitKey: [TodoTask]] = [:]
  /// By day page id: the to-dos its draft applied; only for day pages that hold a plan row.
  private var appliedByDayPage: [CodeUnitKey: Set<CodeUnitKey>] = [:]

  /// Every chip event, in the order each id was first met; see `events(on:)`.
  private(set) var eventsInFirstMetOrder: [DayEvent] = []

  public init(_ workspace: Workspace) {
    var daysWithPlanRows: [String] = []
    var chips = EventCollector()
    for page in workspace.pages where Self.isLive(page) {
      // A document that does not parse reads as no blocks (`pageNodes`).
      let day = page.type == "daily" ? page.date : nil
      var holdsPlanRow = false
      for (taskId, row) in Self.rows(in: Document.blocks(page.document), of: page, day: day, chips: &chips) {
        let key = CodeUnitKey(taskId)
        rowsByTask[key, default: []].append(row)
        guard row.role == .plan, let day else { continue }
        holdsPlanRow = true
        if let held = plannedDays[key], !(held < day) { continue }
        plannedDays[key] = day
      }
      if holdsPlanRow { daysWithPlanRows.append(page.id) }
    }
    // Titles need every page, so only a workspace that holds a chip pays for reading them.
    if !chips.isEmpty { eventsInFirstMetOrder = chips.events(pages: workspace.pages) }
    readDrafts(of: daysWithPlanRows, in: workspace)
    readRepeats(in: workspace)
    readBlockers(in: workspace)
  }

  /// A page that holds rows: not in Trash (an empty stamp is none, as `Boolean(p.trashedAt)`), not the day template,
  /// not a day's draft (`livePages`).
  private static func isLive(_ page: Page) -> Bool {
    (page.trashedAt?.isEmpty ?? true) && page.type != "template" && !page.isDraft
  }

  /// Every to-do row of the blocks, a row before the rows nested under it (`flatNodes`, `isTaskRow`). The same
  /// walk hands each block's chips to `chips`, so no document is read twice.
  private static func rows(
    in blocks: [Block], of page: Page, day: LocalDate?, chips: inout EventCollector
  ) -> [(taskId: String, row: TaskRow)] {
    var found: [(taskId: String, row: TaskRow)] = []
    for block in blocks {
      if block.type == "task", let taskId = block.props["taskId"]?.stringValue {
        found.append((taskId, TaskRow(pageId: page.id, day: day, blockId: block.id, role: RowRole(block.props["role"]))))
      }
      chips.read(block, on: page, pageDate: day)
      found += rows(in: block.children, of: page, day: day, chips: &chips)
    }
    return found
  }

  private mutating func readDrafts(of dayPageIds: [String], in workspace: Workspace) {
    guard !dayPageIds.isEmpty else { return }
    // `draftOf`: the first draft page of that id that is not in Trash.
    var drafts: [CodeUnitKey: Page] = [:]
    for page in workspace.pages where page.isDraft && (page.trashedAt?.isEmpty ?? true) {
      let key = CodeUnitKey(page.id)
      if drafts[key] == nil { drafts[key] = page }
    }
    for dayPageId in dayPageIds {
      guard let page = drafts[CodeUnitKey(Workspace.draftPageId(of: dayPageId))],
        let draft = DayDraft(document: page.document)
      else { continue }
      appliedByDayPage[CodeUnitKey(dayPageId)] = draft.appliedTaskIds
    }
  }

  /// `repeatsIn`: an open to-do that is some repeat's current one; of two repeats naming one to-do, the later wins,
  /// as in the web's `Map`. A repeat that does not read is not in force.
  private mutating func readRepeats(in workspace: Workspace) {
    guard let records = workspace.rest["todoRepeats"]?.arrayValue, !records.isEmpty else { return }
    let open = Set(workspace.tasks.filter { $0.status == .open }.map { CodeUnitKey($0.id) })
    for record in records {
      guard let taskId = record.objectValue?["taskId"]?.stringValue, open.contains(CodeUnitKey(taskId)),
        let rule = RepeatRule(record)
      else { continue }
      repeatRules[CodeUnitKey(taskId)] = rule
    }
  }

  /// `blockedNow` over `liveTaskIds`: a link is in force while both ends have a row on a live page, the blocker is
  /// open (paused still holds) and the to-do itself is open. A link that does not read is not in force.
  private mutating func readBlockers(in workspace: Workspace) {
    guard let links = workspace.rest["links"]?.arrayValue, !links.isEmpty else { return }
    var live: [CodeUnitKey: TodoTask] = [:]
    for task in workspace.tasks where rowsByTask[CodeUnitKey(task.id)] != nil { live[CodeUnitKey(task.id)] = task }
    for link in links {
      guard let blockedId = link.objectValue?["blockedId"]?.stringValue,
        let blockerId = link.objectValue?["blockerId"]?.stringValue,
        let blocked = live[CodeUnitKey(blockedId)], let blocker = live[CodeUnitKey(blockerId)],
        blocked.status == .open, blocker.status == .open
      else { continue }
      blockersByTask[CodeUnitKey(blocked.id), default: []].append(blocker)
    }
  }

  /// `plannedOn`: the newest day page holding a plan row of it; nil when none does.
  public func plannedOn(_ taskId: String) -> LocalDate? { plannedDays[CodeUnitKey(taskId)] }

  /// In page order, then document order.
  public func rows(of taskId: String) -> [TaskRow] { rowsByTask[CodeUnitKey(taskId)] ?? [] }

  /// The rule of the repeat whose current to-do this is, when the to-do is open (`repeatsIn`).
  public func repeatRule(of taskId: String) -> RepeatRule? { repeatRules[CodeUnitKey(taskId)] }

  /// Its blockers in force, in the order the links were made (`blockedNow` over `liveTaskIds`); empty when none.
  public func blockers(of taskId: String) -> [TodoTask] { blockersByTask[CodeUnitKey(taskId)] ?? [] }

  /// The day `task` has been carried since, when it is open on today's plan and that is at least a week ago
  /// (`carriedSince` in `src/domain/carried.ts`). It counts from the later of the day it was first saved and the last
  /// day chosen for it: a plan row on a day counts as chosen unless that day's draft applied the to-do.
  public func carriedSince(_ task: TodoTask, today: LocalDate) -> LocalDate? {
    guard task.status == .open, !task.paused, !Workspace.isBlankInJavaScript(task.title),
      plannedOn(task.id) == today
    else { return nil }
    let taskKey = CodeUnitKey(task.id)
    // A to-do without a readable `createdOn` has no start: any plan day is later than it.
    var since = task.raw["createdOn"]?.stringValue.flatMap(LocalDate.init)
    for row in rows(of: task.id) {
      guard row.role == .plan, let day = row.day, day <= today else { continue }
      if let since, day <= since { continue }
      if appliedByDayPage[CodeUnitKey(row.pageId)]?.contains(taskKey) == true { continue }
      since = day
    }
    guard let since, let weekAgo = today.adding(days: -7), since <= weekAgo else { return nil }
    return since
  }
}
