import Foundation

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
/// Building it parses each live page's document once, each draft page once, and the workspace's repeats and links.
/// Nothing it answers reads a document again: the same walk notes where each line a stored draft says it came from
/// first sits (`decidedMatch`'s `sourceDay`). It is a value: a caller keeps it beside the workspace it was built from
/// (for a screen, in the model that holds the workspace) and builds a new one when that workspace changes.
public struct TodoIndex: Sendable {
  private var rowsByTask: [CodeUnitKey: [TaskRow]] = [:]
  private var plannedDays: [CodeUnitKey: LocalDate] = [:]
  private var repeatRules: [CodeUnitKey: RepeatRule] = [:]
  private var blockersByTask: [CodeUnitKey: [TodoTask]] = [:]
  /// Every draft page not in Trash that reads, in the workspace's order (`takenOver`, `decidedElsewhere`,
  /// `skippedDays` walk them).
  /// `document` is the page's stored text the draft was read from, kept so the next index can tell it unchanged.
  private(set) var dayDrafts: [(pageId: String, parentId: String?, document: String, draft: DayDraft)] = []
  /// By draft page id: `draftOf`'s answer, the first draft page of an id that is not in Trash.
  private var draftsByPageId: [CodeUnitKey: DayDraft] = [:]
  /// The draft pages this index parsed rather than took from the index it reused.
  private(set) var draftsParsed = 0
  /// Draft pages not in Trash whose document is no draft, kept so the next index does not parse them again.
  private var unreadableDrafts: [(pageId: String, document: String)] = []

  /// Every chip event, in the order each id was first met; see `events(on:)`.
  private(set) var eventsInFirstMetOrder: [DayEvent] = []
  /// Where the lines the stored drafts' items say they came from (`from`) first sit on a live page.
  private var sources = BlockSources(sought: [])

  /// `previous`, an index of an earlier workspace, lends the drafts it read: a draft page whose document is the same
  /// text, code unit for code unit, as one `previous` read from a page of that id is not parsed again. Nothing else is
  /// taken from it, so any index gives the same answers as none; one of the same workspace's line spares the most.
  public init(_ workspace: Workspace, reusing previous: TodoIndex? = nil) {
    // The drafts first, so the walk over the pages knows which lines' places to note.
    readDrafts(in: workspace, reusing: previous)
    sources = BlockSources(sought: Set(dayDrafts.lazy.flatMap { $0.draft.items.lazy.compactMap(\.from) }))
    var chips = EventCollector()
    for (position, page) in workspace.pages.enumerated() where Self.isLive(page) {
      // A document that does not parse reads as no blocks (`pageNodes`).
      let day = page.type == "daily" ? page.date : nil
      let blocks = Document.blocks(page.document)
      for (taskId, row) in Self.rows(in: blocks, of: page, at: position, day: day, chips: &chips, sources: &sources) {
        let key = CodeUnitKey(taskId)
        rowsByTask[key, default: []].append(row)
        guard row.role == .plan, let day else { continue }
        if let held = plannedDays[key], !(held < day) { continue }
        plannedDays[key] = day
      }
    }
    // Titles need every page, so only a workspace that holds a chip pays for reading them.
    if !chips.isEmpty { eventsInFirstMetOrder = chips.events(pages: workspace.pages) }
    readRepeats(in: workspace)
    readBlockers(in: workspace)
  }

  /// A page that holds rows: not in Trash (an empty stamp is none, as `Boolean(p.trashedAt)`), not the day template,
  /// not a day's draft (`livePages`).
  static func isLive(_ page: Page) -> Bool {
    (page.trashedAt?.isEmpty ?? true) && page.type != "template" && !page.isDraft
  }

  /// Every to-do row of the blocks, a row before the rows nested under it (`flatNodes`, `isTaskRow`). The same
  /// walk hands each block's chips to `chips` and its id to `sources`, so no document is read twice.
  private static func rows(
    in blocks: [Block], of page: Page, at position: Int, day: LocalDate?, chips: inout EventCollector,
    sources: inout BlockSources
  ) -> [(taskId: String, row: TaskRow)] {
    var found: [(taskId: String, row: TaskRow)] = []
    for block in blocks {
      if block.type == "task", let taskId = block.props["taskId"]?.stringValue {
        found.append((taskId, TaskRow(pageId: page.id, day: day, blockId: block.id, role: RowRole(block.props["role"]))))
      }
      chips.read(block, on: page, pageDate: day)
      sources.read(block, at: position)
      found += rows(in: block.children, of: page, at: position, day: day, chips: &chips, sources: &sources)
    }
    return found
  }

  /// Each draft page is parsed here and nowhere else: a page of an id already met is not read (`draftOf` takes the
  /// first, and a first that does not parse is no draft, not a reason to take the second), but it is still one of
  /// `dayDrafts` when it reads, as `takenOver` walks every page.
  private mutating func readDrafts(in workspace: Workspace, reusing previous: TodoIndex?) {
    // What `previous` read, by page id: usually one document an id, more only for pages sharing an id.
    // A document that did not read is remembered too (as nil), so it is not parsed again either.
    var read: [CodeUnitKey: [(document: String, draft: DayDraft?)]] = [:]
    for stored in previous?.dayDrafts ?? [] {
      read[CodeUnitKey(stored.pageId), default: []].append((stored.document, stored.draft))
    }
    for stored in previous?.unreadableDrafts ?? [] {
      read[CodeUnitKey(stored.pageId), default: []].append((stored.document, nil))
    }
    var met = Set<CodeUnitKey>()
    for page in workspace.pages where page.isDraft && (page.trashedAt?.isEmpty ?? true) {
      let key = CodeUnitKey(page.id)
      let first = met.insert(key).inserted
      let kept = read[key]?.first(where: { Self.sameText($0.document, page.document) })
      if kept == nil { draftsParsed += 1 }
      guard let draft = kept.map(\.draft) ?? DayDraft(document: page.document) else {
        unreadableDrafts.append((page.id, page.document))
        continue
      }
      dayDrafts.append((page.id, page.parentId, page.document, draft))
      if first { draftsByPageId[key] = draft }
    }
  }

  /// The same text, code unit for code unit (not Swift's canonical equivalence). A string that shares its storage with
  /// the other, as an unchanged page's document does from one workspace value to the next, is known at once.
  private static func sameText(_ a: String, _ b: String) -> Bool {
    var a = a, b = b
    return a.withUTF8 { x in
      b.withUTF8 { y in
        guard x.count == y.count else { return false }
        guard let first = x.baseAddress, let second = y.baseAddress, first != second else { return true }
        return memcmp(first, second, x.count) == 0
      }
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

  /// `draftOf`: the draft of a day page, from the draft pages the index parsed once (not in Trash; the first of an id).
  public func dayDraft(of dayPageId: String) -> DayDraft? {
    draftsByPageId[CodeUnitKey(Workspace.draftPageId(of: dayPageId))]
  }

  /// The place among the workspace's pages of the first live page holding a block of this id, for a line some stored
  /// draft's item says it came from: `.some(nil)` when no live page holds it, nil when the index did not look.
  func firstLivePage(holding blockId: String) -> Int?? { sources.firstLivePage(holding: blockId) }

  /// The standing draft rule of `use-day-draft.ts:91`: stored, and not stale.
  public func draftStands(for dayPageId: String) -> Bool {
    dayDraft(of: dayPageId).map { !$0.stale } ?? false
  }

  /// `plannedAfter`'s question for one to-do: a plan row on a day page dated after `day`.
  public func isPlanned(_ taskId: String, after day: LocalDate) -> Bool {
    rows(of: taskId).contains { $0.role == .plan && ($0.day.map { day < $0 } ?? false) }
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
      if dayDraft(of: row.pageId)?.appliedTaskIds.contains(taskKey) == true { continue }
      since = day
    }
    guard let since, let weekAgo = today.adding(days: -7), since <= weekAgo else { return nil }
    return since
  }
}

/// Where each sought block id first sits on a live page, met as the index walks the pages in the workspace's order.
private struct BlockSources: Sendable {
  /// Compared as Swift strings, which may take two ids for one where the web would not: that only notes more blocks
  /// than were sought, each under its own code units, so every id's answer is still its own.
  let sought: Set<String>
  private var firstPage: [CodeUnitKey: Int] = [:]

  init(sought: Set<String>) { self.sought = sought }

  mutating func read(_ block: Block, at position: Int) {
    guard !sought.isEmpty, sought.contains(block.id) else { return }
    let key = CodeUnitKey(block.id)
    if firstPage[key] == nil { firstPage[key] = position }
  }

  func firstLivePage(holding blockId: String) -> Int?? {
    guard sought.contains(blockId) else { return nil }
    return .some(firstPage[CodeUnitKey(blockId)])
  }
}
