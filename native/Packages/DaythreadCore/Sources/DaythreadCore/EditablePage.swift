/// An open page as he edits it: its blocks as a tree, and the keys of spec §10.3 as operations on it.
///
/// Only the lines the app draws are edited. A block of a kind the app does not draw the inside of (a database,
/// a synced block, an image, …) holds no caret, is never changed, and nothing under it is touched, so it is
/// written back exactly as it was read.
public struct EditablePage: Sendable {
  public struct Caret: Hashable, Sendable {
    public var block: String
    /// UTF-16 units into the line's words, as `InlineContent` counts them.
    public var offset: Int

    public init(block: String, offset: Int) {
      self.block = block
      self.offset = offset
    }
  }

  public enum Key: Sendable { case returnKey, backspace, tab, shiftTab }

  public private(set) var blocks: [Block]
  /// The rows he removed one at a time, in the web's two cases (spec §10.3).
  public private(set) var singleDeleteIds: [String] = []
  /// The page's day, for a to-do made with no row to copy its role and plan date from.
  let pageDate: LocalDate?
  let makeID: @Sendable () -> String

  public init(document: String, pageDate: LocalDate?, makeID: @escaping @Sendable () -> String = NewBlock.id) {
    blocks = Document.blocks(document)
    self.pageDate = pageDate
    self.makeID = makeID
  }

  public var document: String { Document.write(blocks) }

  /// Typing and deleting inside one line. Returns where the caret is afterwards. A line that cannot hold a
  /// caret, or an id not on the page, is left alone.
  public mutating func replaceText(in block: String, range: Range<Int>, with text: String) -> Caret {
    guard let path = editablePath(of: block) else { return Caret(block: block, offset: range.lowerBound) }
    var words = InlineContent(self[path].content)
    let start = Self.characterStart(range.lowerBound, in: words)
    words.replace(range, with: text)
    self[path].content = words.json
    return Caret(block: block, offset: start + text.utf16.count)
  }

  /// A key at a caret. Nil when the key does nothing there.
  public mutating func press(_ key: Key, at caret: Caret) -> Caret? {
    switch key {
    case .returnKey: pressReturn(at: caret)
    case .backspace, .tab, .shiftTab: nil
    }
  }

  public func content(of block: String) -> InlineContent? {
    editablePath(of: block).map { InlineContent(self[$0].content) }
  }

  /// Whether a line can hold a caret (a text kind the app draws), in page order.
  public var textBlocks: [String] {
    var ids: [String] = []
    func walk(_ list: [Block]) {
      for block in list {
        if Self.textTypes.contains(block.type) { ids.append(block.id) }
        if Self.drawnTypes.contains(block.type) { walk(block.children) }
      }
    }
    walk(blocks)
    return ids
  }
}

// MARK: - The tree

extension EditablePage {
  /// Index of each block on the way down from the page's top level.
  typealias Path = [Int]

  /// The kinds whose words the app draws and edits, as stored.
  static let textTypes: Set<String> = ["paragraph", "heading", "bulletListItem", "numberedListItem", "quote", "task"]
  /// The kinds the app draws, whose nested lines it therefore draws too.
  static let drawnTypes: Set<String> = textTypes.union(["divider"])

  /// The first block with that id in page order, among the blocks the app draws. A stored page can repeat an id
  /// (wrongly); acting on the first keeps every operation well defined.
  func path(of id: String) -> Path? {
    func search(_ list: [Block], _ prefix: Path) -> Path? {
      for (index, block) in list.enumerated() {
        let path = prefix + [index]
        if block.id == id { return path }
        if Self.drawnTypes.contains(block.type), let found = search(block.children, path) { return found }
      }
      return nil
    }
    return search(blocks, [])
  }

  /// The path of a line that can hold a caret.
  func editablePath(of id: String) -> Path? {
    guard let path = path(of: id), Self.textTypes.contains(self[path].type) else { return nil }
    return path
  }

  subscript(path: Path) -> Block {
    get {
      var block = blocks[path[0]]
      for index in path.dropFirst() { block = block.children[index] }
      return block
    }
    set { Self.modifyList(&blocks, under: path.dropLast()[...]) { $0[path[path.count - 1]] = newValue } }
  }

  /// Runs `body` on the list of blocks that holds the block at `path`, with its index there.
  mutating func modifySiblings<R>(of path: Path, _ body: (inout [Block], Int) -> R) -> R {
    Self.modifyList(&blocks, under: path.dropLast()[...]) { body(&$0, path[path.count - 1]) }
  }

  /// Runs `body` on the children of the block at `path` (the top level for an empty path).
  mutating func modifyChildren<R>(of path: Path, _ body: (inout [Block]) -> R) -> R {
    Self.modifyList(&blocks, under: path[...], body)
  }

  private static func modifyList<R>(
    _ list: inout [Block], under path: ArraySlice<Int>, _ body: (inout [Block]) -> R
  ) -> R {
    guard let first = path.first else { return body(&list) }
    return modifyList(&list[first].children, under: path.dropFirst(), body)
  }

  /// Where an offset lands as `InlineContent.replace` reads it: clamped to the line, and moved back to the start
  /// of a character it would cut in two.
  private static func characterStart(_ offset: Int, in words: InlineContent) -> Int {
    let units = Array(words.plain.utf16)
    let clamped = min(max(offset, 0), units.count)
    let cutsPair =
      clamped > 0 && clamped < units.count && UTF16.isLeadSurrogate(units[clamped - 1])
      && UTF16.isTrailSurrogate(units[clamped])
    return cutsPair ? clamped - 1 : clamped
  }
}
