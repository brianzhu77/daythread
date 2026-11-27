/// Backspace at the start of a line, as the web's editor does it: the app's own handlers first (`page-editor.tsx`,
/// `keptBlock`, `plainFirstLine` and the empty to-do's branch), then BlockNote 0.56's `handleBackspace`
/// (`KeyboardShortcutsExtension.ts`) and `mergeBlocksCommand` (`mergeBlocks.ts`). Backspace inside the words is the
/// text view's, through `replaceText`.
///
/// Where the app differs from the web, on purpose: a line under a synced block or a database is never joined
/// into it (spec §10.3), and a line removed by Backspace leaves its nested lines in its place where the web's
/// `removeBlocks` would take them with it.
extension EditablePage {
  mutating func pressBackspace(at caret: Caret, after shortcut: TypedShortcut?) -> Caret? {
    guard let path = editablePath(of: caret.block), caret.offset <= 0 else { return nil }
    if let shortcut, shortcut.block == caret.block {
      self[path] = shortcut.paragraph
      return Caret(block: caret.block, offset: shortcut.typed)
    }
    let line = self[path]
    // The web's `caretAtDocumentStart`: the first line of words on the page, whatever blocks come before it.
    let isFirstLine = textBlocks.first == line.id
    switch line.type {
    case "paragraph":
      return joinAbove(line, at: path)
    case "task" where isFirstLine:
      // `plainFirstLine`, which the web runs before the empty to-do's rule: the row stays, as a paragraph.
      self[path] = Self.asParagraph(line)
      letGo(line.id)
      return Caret(block: line.id, offset: 0)
    case "task" where InlineContent(line.content).isEmpty:
      guard let caret = removeLine(line, at: path) else { return nil }
      letGo(line.id)
      return caret
    default:
      // `resetsTo`: a bullet, a numbered item, a quote, a heading or a to-do becomes a paragraph where it is.
      self[path] = Self.asParagraph(line)
      return Caret(block: line.id, offset: 0)
    }
  }

  /// A paragraph meets the line drawn above it.
  private mutating func joinAbove(_ line: Block, at path: Path) -> Caret? {
    guard let (abovePath, isParent) = pathAbove(path) else { return nil }
    let above = self[abovePath]
    let isEmpty = InlineContent(line.content).isEmpty
    if Self.textTypes.contains(above.type) { return join(line, at: path, into: above, at: abovePath, isParent: isParent) }
    switch above.type {
    case "divider":
      if isEmpty { return removeLine(line, at: path) }
      // A divider holds no words to join into, so it goes. As a parent, what was nested under it takes its place;
      // as the line drawn above, the line moves into its place ("deletes previous block if it contains no content").
      if isParent {
        replaceWithChildren(at: abovePath)
      } else {
        moveUp(line, at: path, into: abovePath)
      }
      return Caret(block: line.id, offset: 0)
    case "syncedBlock", "database":
      return nil
    default:
      return isEmpty ? removeLine(line, at: path) : nil
    }
  }

  /// `mergeBlocksCommand`: the upper line keeps its id, type and props and takes the words; the lower line's
  /// nested lines take its place, one level up. Into an empty paragraph with the same props, the lower line moves
  /// up instead, keeping its id and nested lines (BlockNote #550). That exception is only for a previous line, not
  /// a parent (`mergeIntoParent` has none).
  private mutating func join(_ line: Block, at path: Path, into above: Block, at abovePath: Path, isParent: Bool)
    -> Caret
  {
    let upper = InlineContent(above.content)
    if !isParent, upper.isEmpty, above.type == "paragraph",
      Self.asParagraph(above).props == Self.asParagraph(line).props
    {
      moveUp(line, at: path, into: abovePath)
      return Caret(block: line.id, offset: 0)
    }
    let lower = InlineContent(line.content)
    if !lower.isEmpty { self[abovePath].content = upper.appending(lower).json }
    replaceWithChildren(at: path)
    return Caret(block: above.id, offset: upper.length)
  }

  /// The block drawn right above a line: the previous sibling's deepest last nested block, never looking inside a
  /// block the app does not draw the inside of; or the parent, for a first nested line. Nil on the page's first
  /// line.
  private func pathAbove(_ path: Path) -> (path: Path, isParent: Bool)? {
    let index = path[path.count - 1]
    guard index > 0 else { return path.count > 1 ? (Array(path.dropLast()), true) : nil }
    var above = Array(path.dropLast()) + [index - 1]
    while Self.drawnTypes.contains(self[above].type), !self[above].children.isEmpty {
      above.append(self[above].children.count - 1)
    }
    return (above, false)
  }

  /// Removes a line, its nested lines taking its place, and puts the caret at the end of the nearest line above
  /// that holds one, else at the start of the next. With no other line to hold the caret, nothing is removed.
  private mutating func removeLine(_ line: Block, at path: Path) -> Caret? {
    let lines = textBlocks
    guard let index = lines.firstIndex(of: line.id) else { return nil }
    let caret: Caret
    if index > 0, let words = content(of: lines[index - 1]) {
      caret = Caret(block: lines[index - 1], offset: words.length)
    } else if index + 1 < lines.count {
      caret = Caret(block: lines[index + 1], offset: 0)
    } else {
      return nil
    }
    replaceWithChildren(at: path)
    return caret
  }

  /// The line, with its nested lines, takes the place of the block drawn above it, which goes. That block is in the
  /// previous sibling's subtree, so removing the line first leaves its path alone.
  private mutating func moveUp(_ line: Block, at path: Path, into abovePath: Path) {
    modifySiblings(of: path) { list, index in _ = list.remove(at: index) }
    self[abovePath] = line
  }

  /// The save names the row so the server settles its to-do as a single delete. The web adds the row's block id
  /// (`semanticDeletes.current.add(block.id)`), and the server matches it against row ids (`workspace.ts`,
  /// `single.has(r.id)`).
  private mutating func letGo(_ row: String) {
    if !singleDeleteIds.contains(row) { singleDeleteIds.append(row) }
  }
}
