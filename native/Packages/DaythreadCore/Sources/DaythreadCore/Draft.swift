import Foundation

extension Workspace {
  /// The workspace as drawn while a draft waits: that page's document is the draft's, and each to-do row in it
  /// with words and no to-do in the workspace gets an open to-do under the row's own `taskId`. It is drawn only;
  /// nothing stores it. A page that is not here, or a draft that does not parse, draws nothing new.
  public func drawing(draft document: String, of pageId: String) -> Workspace {
    guard let index = pages.firstIndex(where: { $0.id.hasSameCodeUnits(as: pageId) }), Document.parses(document)
    else { return self }
    var raw = pages[index].raw
    raw["document"] = .string(document)
    guard let page = Page(.object(raw)) else { return self }

    var copy = self
    copy.pages[index] = page
    // `textDate` in `src/domain/editor-document.ts`: only a day page reads its date into a `@date` chip.
    let pageDate = page.type == "daily" ? page.date : nil
    let buried = Set(
      json().objectValue?["deletedTasks"]?.arrayValue?.compactMap { $0.objectValue?["id"]?.stringValue } ?? [])
    for row in Self.todoRows(in: Document.blocks(document)) {
      let words = InlineText.plain(row.content, pageDate: pageDate)
      // The server brings a deleted to-do back from its row instead of making a new one.
      guard copy.task(row.id) == nil, !buried.contains(row.id), !Self.isBlankInJavaScript(words) else { continue }
      if let task = TodoTask(Self.newTask(id: row.id, words: words, page: page)) { copy.tasks.append(task) }
    }
    return copy
  }

  /// `createTask` in `src/domain/workspace.ts`.
  private static func newTask(id: String, words: String, page: Page) -> JSONValue {
    var row = JSONObject()
    row["id"] = .string(id)
    row["title"] = .string(title(from: words))
    row["status"] = .string("open")
    row["version"] = .number("1")
    row["paused"] = .bool(false)
    row["deadlineOn"] = .null
    row["attentionOn"] = .null
    if let day = page.date { row["createdOn"] = .string(day.value) }
    row["sourcePageId"] = .string(page.id)
    return .object(row)
  }

  /// The server's `text(words, 1000)`: no NUL, and at most 1000 UTF-16 units. The server refuses a longer title
  /// outright; a draft that long is drawn with the title cut.
  private static func title(from words: String) -> String {
    let units = words.utf16.filter { $0 != 0 }.prefix(1000)
    return String(decoding: Array(units), as: UTF16.self)
  }

  /// Every to-do row whose `taskId` is a string, children included, in page order (`isTaskRow`).
  private static func todoRows(in blocks: [Block]) -> [(id: String, content: JSONValue?)] {
    var rows: [(id: String, content: JSONValue?)] = []
    for block in blocks {
      if block.type == "task", let id = block.props["taskId"]?.stringValue { rows.append((id, block.content)) }
      rows += todoRows(in: block.children)
    }
    return rows
  }
}
