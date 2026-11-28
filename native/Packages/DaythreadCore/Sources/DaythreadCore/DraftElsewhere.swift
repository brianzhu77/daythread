/// `FROM_RECIPE` (`day-draft.ts:51`): the first recipe whose carried lines say where they came from (`from`).
private let fromRecipe = 3
/// `TYPED_FROM_RECIPE` (`day-draft.ts:53`): the first recipe whose lines typed anew as a line it was sent say which.
private let typedFromRecipe = 5

extension DayDraft {
  /// `itemRecipe` (`day-draft.ts:98`): an item a remake kept from an older draft names its own recipe.
  func recipe(of item: Item) -> Int { item.recipe ?? recipe ?? 1 }
}

/// `tookRef` (`day-draft.ts:84`): how a later draft names an item it took over.
func tookRef(_ dayPageId: String, _ itemId: String) -> CodeUnitKey { CodeUnitKey("\(dayPageId) \(itemId)") }

/// `takenOver` (`day-draft.ts:85-95`): the `tookRef` of every item a stored ready or failed draft took over, from the
/// drafts the index parsed once (every draft page not in Trash that reads, as the web walks them).
func takenOver(_ index: TodoIndex) -> Set<CodeUnitKey> {
  var out = Set<CodeUnitKey>()
  for stored in index.dayDrafts where stored.draft.status == .ready || stored.draft.status == .failed {
    for item in stored.draft.items {
      for ref in item.took { out.insert(CodeUnitKey(ref)) }
    }
  }
  return out
}

/// `decidedElsewhere` with `decidedMatch` (`day-draft.ts:109-166`): whether a line item was decided in another day's
/// draft. Pages are read for a carried line's source day only when an older recipe's item needs it, once per id.
///
/// A line is known by the block it was carried from (`from`); an item an older recipe made has none and is known by
/// its words, but only against a line that could have been in its draft: one from a page dated before that draft's
/// day. The row an applied item became (`row`) is that line too while it still reads the item's words.
///
/// The index answers where a line came from for every line a stored draft names, so only pages it does not hold are
/// parsed here. One reading differs from the web's at its edge: a day page or a draft's parent with no date reads as
/// unknown, so readable, where the web's comparison with `undefined` is false; stored data cannot reach it, as drafts
/// are made only for dated pages. `parse` is how a page is read (a test counts the pages read through it).
func decidedElsewhere(
  in workspace: Workspace, index: TodoIndex, dayPage: Page,
  parse: @escaping (Page) -> [Block] = { Document.blocks($0.document) }
) -> (DayDraft.Item) -> Bool {
  let own = index.dayDraft(of: dayPage.id)
  let match = DecidedMatch(workspace, index: index, dayPage: dayPage, parse: parse)
  return { item in match.matches(item, old: own.map { $0.recipe(of: item) < fromRecipe } ?? true) }
}

/// The web's `<` on two strings: by UTF-16 code units.
private func precedesInJavaScript(_ a: String, _ b: String) -> Bool { a.utf16.lexicographicallyPrecedes(b.utf16) }

/// `decidedMatch`'s closure and the cache of `sourceDay` it fills as it is asked. Not shared: the view reads it on one
/// thread and drops it.
private final class DecidedMatch {
  /// An item decided in another day's draft (`Decided`, `day-draft.ts:130`). Days are kept as the web's strings.
  private struct Decided {
    let from: String?
    let row: String?
    let words: String
    let old: Bool
    let day: String?
  }

  private let decided: [Decided]
  private let pages: [Page]
  private let dayPageDate: String?
  private var sourceDays: [CodeUnitKey: String?] = [:]
  /// The flattened block ids of each page searched so far, by its place in `pages`: no page is parsed twice.
  private var blockIds: [Int: Set<CodeUnitKey>] = [:]

  private let parse: (Page) -> [Block]
  private let index: TodoIndex

  init(_ workspace: Workspace, index: TodoIndex, dayPage: Page, parse: @escaping (Page) -> [Block]) {
    self.parse = parse
    self.index = index
    pages = workspace.pages
    dayPageDate = dayPage.raw["date"]?.stringValue
    let ownId = CodeUnitKey(Workspace.draftPageId(of: dayPage.id))
    var dates: [CodeUnitKey: String?]?
    var decided: [Decided] = []
    for stored in index.dayDrafts where CodeUnitKey(stored.pageId) != ownId {
      for item in stored.draft.items where item.state != .open {
        guard let words = item.words else { continue }
        // `ws.pages.find(x => x.id === p.parentId)?.date`: the first page of that id, whatever it is.
        if dates == nil { dates = Self.firstDates(of: workspace.pages) }
        let day = stored.parentId.flatMap { dates?[CodeUnitKey($0)] ?? nil }
        decided.append(
          Decided(
            from: item.from, row: item.row, words: words,
            old: item.from == nil && stored.draft.recipe(of: item) < typedFromRecipe, day: day))
      }
    }
    self.decided = decided
  }

  private static func firstDates(of pages: [Page]) -> [CodeUnitKey: String?] {
    var dates: [CodeUnitKey: String?] = [:]
    for page in pages where dates[CodeUnitKey(page.id)] == nil {
      dates[CodeUnitKey(page.id)] = .some(page.raw["date"]?.stringValue)
    }
    return dates
  }

  /// `old`: the item was made by a recipe before `FROM_RECIPE`, so it is known by its words. The checks run in the
  /// web's order (`day-draft.ts:156-164`): the first that answers decides for that decided item.
  func matches(_ item: DayDraft.Item, old: Bool) -> Bool {
    guard let words = item.words else { return false }
    return decided.contains { other in
      if let from = item.from, let row = other.row, from.hasSameCodeUnits(as: row),
        words.hasSameCodeUnits(as: other.words)
      {
        return true
      }
      if let from = item.from, let otherFrom = other.from { return from.hasSameCodeUnits(as: otherFrom) }
      if words.isEmpty || !words.hasSameCodeUnits(as: other.words) { return false }
      if old && other.old { return true }
      if old, let otherFrom = other.from { return readable(otherFrom, before: dayPageDate) }
      if other.old, let from = item.from { return readable(from, before: other.day) }
      return false
    }
  }

  /// `readable` (`day-draft.ts:152`): could the line carried from `id` have been in a draft for `day`? Unknown counts
  /// as yes: a second copy is the worse mistake.
  private func readable(_ id: String, before day: String?) -> Bool {
    guard let source = sourceDay(id), let day else { return true }
    return precedesInJavaScript(source, day)
  }

  /// `sourceDay` (`day-draft.ts:144-150`): the day of the first page that is not a draft (in Trash or not, a template
  /// or not) holding a block of that id: a day page's date, another page's creation day; nil when unknown.
  ///
  /// The index already knows the first live page holding a line a stored draft names; only the pages it does not hold
  /// (in Trash, templates) that come before that one are parsed, to keep the web's "first in the workspace's order".
  private func sourceDay(_ id: String) -> String? {
    let key = CodeUnitKey(id)
    if let known = sourceDays[key] { return known }
    var holder: Page?
    switch index.firstLivePage(holding: id) {
    case .some(let live):
      for position in 0..<(live ?? pages.count) {
        let page = pages[position]
        if !page.isDraft, !TodoIndex.isLive(page), ids(of: page, at: position).contains(key) {
          holder = page
          break
        }
      }
      if holder == nil, let live { holder = pages[live] }
    case nil:
      // An id no stored draft names, which the index did not look for: every page that is not a draft is searched.
      for (position, page) in pages.enumerated() where !page.isDraft && ids(of: page, at: position).contains(key) {
        holder = page
        break
      }
    }
    let found = holder.flatMap { page in
      page.type == "daily" ? page.raw["date"]?.stringValue : page.raw["createdAt"]?.stringValue.map(Self.dayPart)
    }
    sourceDays[key] = .some(found)
    return found
  }

  private func ids(of page: Page, at position: Int) -> Set<CodeUnitKey> {
    if let known = blockIds[position] { return known }
    let ids = Set(parse(page).flatMap(\.flattened).map { CodeUnitKey($0.id) })
    blockIds[position] = ids
    return ids
  }

  /// `createdAt.slice(0, 10)`: its first ten UTF-16 code units.
  private static func dayPart(_ stamp: String) -> String {
    String(decoding: Array(stamp.utf16.prefix(10)), as: UTF16.self)
  }
}
