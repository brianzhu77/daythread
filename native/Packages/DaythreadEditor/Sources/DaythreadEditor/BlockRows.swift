import DaythreadCore

/// The rows of a page: its document, flattened depth first.
public enum BlockRows {
  /// A child is one deeper than its parent. A block with an id an earlier block already has gets the id
  /// followed by `#2`, `#3` and so on, in document order, so every row's id is unique. A document that
  /// does not parse has no rows.
  public static func rows(for page: Page, in workspace: Workspace) -> [BlockRow] {
    rows(for: page, in: workspace, today: nil)
  }

  /// As `rows(for:in:)`, each to-do row with its facts read against `today`. `today` nil draws no facts, as before
  /// 1c. The index is built once per call.
  public static func rows(for page: Page, in workspace: Workspace, today: LocalDate?) -> [BlockRow] {
    let facts = today.map { FactsSource(today: $0, pageDate: page.date, index: TodoIndex(workspace)) }
    return rows(for: Document.blocks(page.document), in: workspace, facts: facts)
  }

  /// What a to-do row's facts are read with: one index of the workspace for all the rows of a call.
  struct FactsSource {
    let today: LocalDate
    /// The page's own day; nil when it is not a day page.
    let pageDate: LocalDate?
    let index: TodoIndex
  }

  /// The rows of a page's blocks, as `rows(for:in:today:)` gives them: the page being edited is drawn from its blocks.
  /// `facts` nil draws no facts.
  static func rows(for blocks: [Block], in workspace: Workspace, facts: FactsSource? = nil) -> [BlockRow] {
    var ids = RowIDs(blocks)
    var rows: [BlockRow] = []

    // An explicit stack: a document nests as deep as its author made it.
    struct Pending {
      let block: Block
      let depth: Int
      let number: Int
    }
    var stack: [Pending] = numbered(blocks).reversed().map { Pending(block: $0.block, depth: 0, number: $0.number) }
    while let item = stack.popLast() {
      let block = item.block
      rows.append(
        BlockRow(
          id: ids.unique(block.id), kind: kind(of: block, number: item.number, in: workspace, facts: facts),
          depth: item.depth, content: hasInlineContent(block) ? block.content : nil))
      if hasChildren(block) {
        for child in numbered(block.children).reversed() {
          stack.append(Pending(block: child.block, depth: item.depth + 1, number: child.number))
        }
      }
    }
    return rows
  }

  /// Each sibling with its place in the run of numbered items it belongs to (0 when it is not one).
  private static func numbered(_ siblings: [Block]) -> [(block: Block, number: Int)] {
    var count = 0
    return siblings.map { block in
      count = block.type == "numberedListItem" ? count + 1 : 0
      return (block, count)
    }
  }

  private static func kind(of block: Block, number: Int, in workspace: Workspace, facts: FactsSource?) -> BlockRow.Kind {
    switch block.type {
    case "paragraph": .text(style: .paragraph)
    case "heading": .text(style: .heading(level: level(of: block)))
    case "bulletListItem": .text(style: .bullet)
    case "numberedListItem": .text(style: .numbered(number))
    case "quote": .text(style: .quote)
    case "divider": .separator
    case "task":
      todo(of: block, in: workspace, facts: facts)
    default: .placeholder(name: placeholderName(for: block.type))
    }
  }

  private static func level(of block: Block) -> Int {
    guard let level = block.props["level"]?.intValue, (1...3).contains(level) else { return 2 }
    return level
  }

  /// The status is the task's, never the block's own.
  private static func todo(of block: Block, in workspace: Workspace, facts source: FactsSource?) -> BlockRow.Kind {
    let id = block.props["taskId"]?.stringValue ?? ""
    let facts = source.flatMap {
      RowFacts.of(row: block, pageDate: $0.pageDate, in: workspace, index: $0.index, today: $0.today)
    }
    guard let task = workspace.task(id) else {
      return .todo(taskId: id, status: nil, paused: false, facts: facts)
    }
    return .todo(taskId: id, status: task.status, paused: task.paused, facts: facts)
  }

  private static func placeholderName(for type: String) -> String {
    switch type {
    case "database": "Database"
    case "pageLink": "Page"
    case "image": "Image"
    case "file": "File"
    case "button": "Button"
    case "smartNote": "Smart note"
    case "syncedBlock": "Synced block"
    case "table": "Table"
    case "codeBlock": "Code"
    default: "Block"
    }
  }

  /// Only text and to-do rows are drawn from content.
  private static func hasInlineContent(_ block: Block) -> Bool {
    switch block.type {
    case "paragraph", "heading", "bulletListItem", "numberedListItem", "quote", "task": true
    default: false
    }
  }

  /// A placeholder's children are not listed.
  private static func hasChildren(_ block: Block) -> Bool {
    switch block.type {
    case "paragraph", "heading", "bulletListItem", "numberedListItem", "quote", "task", "divider": true
    default: false
    }
  }
}

/// Hands out each id once: a repeat gets `id#2`, `id#3`, skipping any id the document itself holds.
private struct RowIDs {
  private var taken: Set<String> = []
  private var reserved: Set<String> = []
  private var repeats: [String: Int] = [:]

  init(_ blocks: [Block]) {
    var stack = blocks
    while let block = stack.popLast() {
      reserved.insert(block.id)
      stack.append(contentsOf: block.children)
    }
  }

  mutating func unique(_ id: String) -> String {
    if taken.insert(id).inserted { return id }
    var n = repeats[id, default: 1]
    var candidate: String
    repeat {
      n += 1
      candidate = "\(id)#\(n)"
    } while taken.contains(candidate) || reserved.contains(candidate)
    repeats[id] = n
    taken.insert(candidate)
    return candidate
  }
}
