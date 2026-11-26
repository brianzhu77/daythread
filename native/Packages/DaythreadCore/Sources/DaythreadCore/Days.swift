extension Workspace {
  /// The date's live page (`dayPage` in `src/domain/workspace.ts`): a page in Trash does not hold the date, and
  /// the id is no part of the rule, since a new page made while an older one sits in Trash has another id.
  public func dayPage(_ date: LocalDate) -> Page? {
    pages.first { $0.type == "daily" && $0.date == date && $0.trashedAt == nil }
  }

  /// The day's page that went to Trash last; the one Restore brings back.
  public func trashedDayPage(_ date: LocalDate) -> Page? {
    var newest: Page?
    for page in pages where page.type == "daily" && page.date == date {
      guard let trashedAt = page.trashedAt, !trashedAt.isEmpty else { continue }
      if let held = newest?.trashedAt, trashedAt.utf8.lexicographicallyPrecedes(held.utf8) { continue }
      newest = page
    }
    return newest
  }

  /// The days with something written (`writtenDays` in `src/domain/page-tree.ts`): a live day page that has content
  /// or a page under it.
  public func writtenDays() -> Set<LocalDate> {
    var days = Set<LocalDate>()
    for page in pages where page.type == "daily" && page.trashedAt == nil {
      guard let date = page.date, !days.contains(date) else { continue }
      if Self.hasContent(page) || hasSubpage(of: page) { days.insert(date) }
    }
    return days
  }

  /// `weekStart` is 1 for Monday; anything else, or nothing, is Sunday.
  public var weekStartsOnMonday: Bool { rest["weekStart"]?.intValue == 1 }

  /// `childPages` of `src/domain/page-tree.ts`: an ordinary document page, not in Trash, whose parent is this page
  /// and which is not a database's row.
  private func hasSubpage(of parent: Page) -> Bool {
    pages.contains { page in
      guard page.type == "document", page.trashedAt == nil, page.parentId?.hasSameCodeUnits(as: parent.id) == true else { return false }
      guard let up = page.parentId.flatMap(self.page) else { return false }
      return !Self.holdsDatabase(up)
    }
  }

  private static func holdsDatabase(_ page: Page) -> Bool {
    switch page.raw["database"] {
    case nil, .null?, .bool(false)?: false
    case .string(let text)?: !text.isEmpty
    case .number(let token)?: token != "0"
    default: true
    }
  }

  /// `hasContent` of `src/domain/page-tree.ts`: a to-do row with a task (an `editor-task:` id is the editor's own,
  /// before the server has made the task), a picture or file with a url, a smart note, or a line with words.
  static func hasContent(_ page: Page) -> Bool {
    let date = page.type == "daily" ? page.date : nil
    func written(_ blocks: [Block]) -> Bool {
      blocks.contains { block in
        if block.type == "task", let id = block.props["taskId"]?.stringValue, !id.hasPrefix("editor-task:") { return true }
        if block.type == "image" || block.type == "file", hasUrl(block.props["url"]) { return true }
        if block.type == "smartNote" { return true }
        if block.type != "heading", !isBlankInJavaScript(InlineText.plain(block.content, pageDate: date)) { return true }
        return written(block.children)
      }
    }
    return written(Document.blocks(page.document))
  }

  private static func hasUrl(_ value: JSONValue?) -> Bool {
    switch value {
    case .string(let text)?: !text.isEmpty
    case .bool(true)?: true
    case .number(let token)?: token != "0"
    case .array?, .object?: true
    default: false
    }
  }

  /// `text.trim() === ""` in JavaScript, whose whitespace is not Swift's.
  private static func isBlankInJavaScript(_ text: String) -> Bool {
    text.unicodeScalars.allSatisfy { scalar in
      switch scalar.value {
      case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
      default: false
      }
    }
  }
}
