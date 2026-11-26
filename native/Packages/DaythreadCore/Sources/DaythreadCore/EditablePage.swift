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
  public internal(set) var singleDeleteIds: [String] = []
  /// The page's day, for a to-do made with no row to copy its role and plan date from.
  let pageDate: LocalDate?
  let makeID: @Sendable () -> String
  /// False when `Document.parses` refuses the stored string. Such a page reads as no blocks, so writing it would
  /// save an empty page over the real one: it is shown, never edited, and `document` stays the stored string.
  public let isReadable: Bool
  /// The string as stored, written back until an operation changes something, so an untouched page is never
  /// rewritten (writing the blocks back can differ in spacing or escapes from what was stored).
  private let stored: String
  private var changed = false
  /// The shortcut the last operation applied, so a Backspace straight after it can put the characters back.
  var lastShortcut: TypedShortcut?

  public init(document: String, pageDate: LocalDate?, makeID: @escaping @Sendable () -> String = NewBlock.id) {
    isReadable = Document.parses(document)
    stored = document
    blocks = Document.blocks(document)
    self.pageDate = pageDate
    self.makeID = makeID
  }

  public var document: String { changed ? Document.write(blocks) : stored }

  /// Typing and deleting inside one line. Returns where the caret is afterwards. When the block is not in
  /// `textBlocks` (or the page is not readable) the page is unchanged and the returned caret means nothing.
  public mutating func replaceText(in block: String, range: Range<Int>, with text: String) -> Caret {
    lastShortcut = nil
    guard isReadable, let path = editablePath(of: block) else { return Caret(block: block, offset: range.lowerBound) }
    var words = InlineContent(self[path].content)
    let start = Self.characterStart(range.lowerBound, in: words)
    words.replace(range, with: text)
    let content = words.json
    if self[path].content != content {
      self[path].content = content
      changed = true
    }
    let caret = Caret(block: block, offset: start + text.utf16.count)
    if let shortcut = applyShortcut(typed: text, at: caret, path: path) {
      changed = true
      return shortcut
    }
    return caret
  }

  /// A key at a caret. Nil when the key does nothing there; a key that does something always changes the page.
  public mutating func press(_ key: Key, at caret: Caret) -> Caret? {
    guard isReadable else { return nil }
    let shortcut = lastShortcut
    lastShortcut = nil
    let result: Caret? =
      switch key {
      case .returnKey: pressReturn(at: caret)
      case .backspace: pressBackspace(at: caret, after: shortcut)
      case .tab: indent(at: caret)
      case .shiftTab: unindent(at: caret)
      }
    if result != nil { changed = true }
    return result
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

  /// Removes the block at `path`, its children taking its place in its list, one level up.
  mutating func replaceWithChildren(at path: Path) {
    modifySiblings(of: path) { list, index in list.replaceSubrange(index...index, with: list[index].children) }
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
