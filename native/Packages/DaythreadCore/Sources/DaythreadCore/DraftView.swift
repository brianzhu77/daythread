/// What today's page shows of its draft (`draftView`, `day-draft.ts:371-399`): the open suggestions, placed against
/// the page as `workspace` draws it, and what `N more open` lists. Read per state and per merge, never per keystroke.
public struct DraftView: Hashable, Sendable {
  /// One suggestion (`DraftItemView`, `day-draft.ts:357-361`), with its words as the band shows them
  /// (`day-draft.tsx:567-578`).
  public struct Suggestion: Hashable, Sendable, Identifiable {
    /// Block type `task`, `bulletListItem`, else a plain line.
    public enum Mark: Hashable, Sendable { case todo, bullet, line }

    /// The item's id.
    public let id: String
    /// 1d.2a draws both after `anchorId`.
    public let kind: DraftPlacement.Kind
    /// The top-level block it follows (`after`), or fills (`fill`); nil: the start of the page.
    public let anchorId: String?
    public let mark: Mark
    /// A carried to-do's current title; else the block's own words.
    public let words: String
    public let taskId: String?
    /// A carried to-do's `createdOn`, or a line's `since`.
    public let since: LocalDate?
    /// The earlier days he skipped a carried to-do, oldest first; empty for none.
    public let skipped: [LocalDate]
    /// Under the words: `skippedLabel`'s `text` when skipped, else `shortLabel(since)` (`Thu 11/19`), else nil.
    public let detail: String?
    /// The detail as VoiceOver reads it: `skippedLabel`'s `full` when skipped; nil (read as shown) otherwise.
    public let spokenDetail: String?
    /// `Suggestion, <words>, <spokenDetail ?? detail>`, or `Suggestion, <words>` (what the guest row's cell reads).
    public let spoken: String

    /// `Apply <words>`
    public var applyLabel: String { "Apply \(words)" }
    /// `Skip <words>`
    public var skipLabel: String { "Skip \(words)" }

    /// `on` is the draft's day, which the skipped days are worded against.
    init(
      id: String, kind: DraftPlacement.Kind, anchorId: String?, mark: Mark, words: String, taskId: String?,
      since: LocalDate?, skipped: [LocalDate], on day: LocalDate?
    ) {
      self.id = id
      self.kind = kind
      self.anchorId = anchorId
      self.mark = mark
      self.words = words
      self.taskId = taskId
      self.since = since
      self.skipped = skipped
      if let day, !skipped.isEmpty {
        let label = SkippedLabel.of(skipped, on: day)
        detail = label.text
        spokenDetail = label.full
      } else {
        detail = since.map(DayWords.shortLabel)
        spokenDetail = nil
      }
      spoken = ["Suggestion", words, spokenDetail ?? detail].compactMap { $0 }.joined(separator: ", ")
    }
  }

  /// A to-do `N more open` lists.
  public struct OpenTask: Hashable, Sendable {
    public let taskId: String
    public let title: String
    public let since: LocalDate?
  }

  /// `ready` when settled, else the stored status.
  public let status: DayDraft.Status
  public let suggestions: [Suggestion]
  /// 1d.2b draws it.
  public let moreOpen: [OpenTask]
  public let planningEndId: String?
  /// 1d.2b.
  public let moreOpenAfterId: String?

  /// Nil when the page has no draft. `page` is the page as `workspace` draws it; `index` is of `workspace`.
  ///
  /// It parses `page`'s document and no other, except, for a line an older recipe made, the pages `decidedMatch` must
  /// search for where a line came from. Everything else it reads from the index: the draft, the other days' drafts,
  /// the plan rows on later days and the skipped to-dos' rows.
  public static func of(page: Page, in workspace: Workspace, index: TodoIndex) -> DraftView? {
    guard let draft = index.dayDraft(of: page.id) else { return nil }
    let blocks = Document.blocks(page.document)
    // `ws.tasks.find`: the first to-do of an id.
    var tasks: [CodeUnitKey: TodoTask] = [:]
    for task in workspace.tasks where tasks[CodeUnitKey(task.id)] == nil { tasks[CodeUnitKey(task.id)] = task }
    let ids = Set(tasks.keys)
    let onPage = Set(
      blocks.lazy.flatMap(\.flattened).filter(\.isTaskRow).compactMap { $0.props["taskId"]?.stringValue }
        .map(CodeUnitKey.init))
    let day = page.date
    /// `offeredOn` (`day-draft.ts:200`): it can be applied and is not planned for a later day.
    func offered(_ task: TodoTask?) -> TodoTask? {
      guard let task, task.eligibleForADraft, !(day.map { index.isPlanned(task.id, after: $0) } ?? false) else {
        return nil
      }
      return task
    }
    // Read only when an open item needs them (`day-draft.ts:378`, `:380`).
    let elsewhere: (DayDraft.Item) -> Bool =
      draft.items.contains { $0.state == .open && $0.block != nil }
      ? decidedElsewhere(in: workspace, index: index, dayPage: page) : { _ in false }
    let taken = takenOver(index)
    let skipped: [CodeUnitKey: [LocalDate]] =
      if let day, draft.items.contains(where: { $0.state == .open && $0.carriesATask }) {
        skippedDays(in: workspace, index: index, before: day)
      } else {
        [:]
      }

    var suggestions: [Suggestion] = []
    for item in draft.items where item.state == .open {
      let task = item.taskId.flatMap { tasks[CodeUnitKey($0)] }
      if item.carriesATask {
        guard let task = offered(task), !onPage.contains(CodeUnitKey(task.id)) else { continue }
      } else if elsewhere(item) {
        continue
      }
      if taken.contains(tookRef(page.id, item.id)) { continue }
      guard let placed = DraftPlanning.place(item, in: blocks, tasks: ids) else { continue }
      let at = DraftPlanning.amongApplied(item, at: placed, in: blocks, draft: draft)
      if let task {
        // The web's `draft-row:<item id>` block: a plan row of the to-do under its current title.
        suggestions.append(
          Suggestion(
            id: item.id, kind: at.kind, anchorId: at.anchorId, mark: .todo, words: task.title, taskId: task.id,
            since: task.createdOn, skipped: skipped[CodeUnitKey(task.id)] ?? [], on: day))
      } else if let block = item.block {
        suggestions.append(
          Suggestion(
            id: item.id, kind: at.kind, anchorId: at.anchorId, mark: Self.mark(of: block),
            words: InlineText.plain(block.content, pageDate: nil), taskId: nil, since: item.since, skipped: [],
            on: day))
      }
      // An item with neither a to-do nor a block has nothing to show; the web's band would fail on it.
    }

    let end = DraftPlanning.end(of: blocks, tasks: ids)
    let moreOpen = draft.moreOpen.compactMap { id -> OpenTask? in
      guard let task = offered(tasks[CodeUnitKey(id)]), !onPage.contains(CodeUnitKey(task.id)) else { return nil }
      return OpenTask(taskId: task.id, title: task.title, since: task.createdOn)
    }
    let last = DraftPlanning.moreOpenAfter(in: blocks, planningEnd: end)
    return DraftView(
      status: draft.settled ? .ready : draft.status, suggestions: suggestions, moreOpen: moreOpen,
      planningEndId: end > 0 ? blocks[end - 1].id : nil,
      moreOpenAfterId: blocks.indices.contains(last) ? blocks[last].id : nil)
  }

  private static func mark(of block: Block) -> Suggestion.Mark {
    switch block.type {
    case "task": .todo
    case "bulletListItem": .bullet
    default: .line
    }
  }
}

extension DayDraft.Item {
  /// `item.taskId` as the web tests it: a carried to-do's id, not empty.
  var carriesATask: Bool { !(taskId ?? "").isEmpty }
}
