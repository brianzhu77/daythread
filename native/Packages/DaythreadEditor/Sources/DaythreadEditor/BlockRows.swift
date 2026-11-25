import DaythreadCore

/// The rows of a page: its document, flattened depth first.
public enum BlockRows {
  /// A child is one deeper than its parent. A block with an id an earlier block already has gets the id
  /// followed by `#2`, `#3` and so on, in document order, so every row's id is unique. A document that
  /// does not parse has no rows.
  public static func rows(for page: Page, in workspace: Workspace) -> [BlockRow] {
    let blocks = Document.blocks(page.document)
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
          id: ids.unique(block.id), kind: kind(of: block, number: item.number, in: workspace),
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

  private static func kind(of block: Block, number: Int, in workspace: Workspace) -> BlockRow.Kind {
    switch block.type {
    case "paragraph": .text(style: .paragraph)
    case "heading": .text(style: .heading(level: level(of: block)))
    case "bulletListItem": .text(style: .bullet)
    case "numberedListItem": .text(style: .numbered(number))
    case "quote": .text(style: .quote)
    case "divider": .separator
    case "task":
      todo(of: block, in: workspace)
    default: .placeholder(name: placeholderName(for: block.type))
    }
  }

  private static func level(of block: Block) -> Int {
    guard let level = block.props["level"]?.intValue, (1...3).contains(level) else { return 2 }
    return level
  }

  /// The status is the task's, never the block's own.
  private static func todo(of block: Block, in workspace: Workspace) -> BlockRow.Kind {
    guard let id = block.props["taskId"]?.stringValue, let task = workspace.task(id) else {
      return .todo(status: nil, paused: false)
    }
    return .todo(status: task.status, paused: task.paused)
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
