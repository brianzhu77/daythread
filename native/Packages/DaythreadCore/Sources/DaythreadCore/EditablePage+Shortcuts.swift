/// A shortcut just applied: the paragraph as it was with the characters typed, so Backspace can put it back.
struct TypedShortcut: Sendable {
  let block: String
  /// UTF-16 units typed, where the caret goes when they are put back.
  let typed: Int
  let paragraph: Block
}

/// The typed shortcuts, as the web's editor has them: BlockNote 0.56's input rules (`Heading/block.ts`,
/// `BulletListItem/block.ts`, `NumberedListItem/block.ts`, `CheckListItem/block.ts` turned into a `task` by
/// `page-editor.tsx`, `Quote/block.ts`) and the app's own `---` (`separator.ts`). Only for a single character
/// typed, and only when the words before the caret are exactly the pattern; `---` in any line but a to-do, the
/// others only in a paragraph.
extension EditablePage {
  mutating func applyShortcut(typed text: String, at caret: Caret, path: Path) -> Caret? {
    let line = self[path]
    guard text.count == 1, line.type != "task" else { return nil }
    var words = InlineContent(line.content)
    // `separatorShortcut` takes any line of words but a to-do, whose dashes stay: turning it would delete the task.
    if text == "-", caret.offset == 3, words.plain == "---" { return makeDivider(of: line, at: path) }
    guard line.type == "paragraph" else { return nil }
    let before = String(decoding: Array(words.plain.utf16).prefix(caret.offset), as: UTF16.self)
    guard text == " ", let kind = Self.shortcutKind(before) else { return nil }

    words.replace(0..<caret.offset, with: "")
    var changed = line
    let made = NewBlock.make(kind, id: line.id, content: nil, pageDate: pageDate)
    changed.type = made.type
    // The type change keeps the colours and alignment the paragraph had, for a kind that has them.
    var props = made.props
    for key in ["backgroundColor", "textColor", "textAlignment"] where props[key] != nil {
      if let value = line.props[key] { props[key] = value }
    }
    changed.props = props
    changed.content = words.json
    self[path] = changed
    lastShortcut = TypedShortcut(block: line.id, typed: caret.offset, paragraph: line)
    return Caret(block: line.id, offset: 0)
  }

  private static func shortcutKind(_ typed: String) -> NewBlock.Kind? {
    switch typed {
    case "# ": return .heading(level: 1)
    case "## ": return .heading(level: 2)
    case "### ": return .heading(level: 3)
    case "- ", "* ": return .bullet
    case "[] ": return .todo
    case "> ": return .quote
    default:
      // `^(\d+)\.\s$`, ASCII digits as in JavaScript; `start` is stored only when it is not 1.
      guard typed.hasSuffix(". ") else { return nil }
      let digits = typed.dropLast(2)
      guard !digits.isEmpty, digits.allSatisfy({ ("0"..."9").contains($0) }), let start = Int(digits) else {
        return nil
      }
      return .numbered(start: start == 1 ? nil : start)
    }
  }

  /// `insertSeparator`: the line is replaced by a new divider holding its nested lines, and the caret goes to the
  /// next line when that is an empty paragraph with nothing nested, else to a new paragraph after the divider.
  private mutating func makeDivider(of line: Block, at path: Path) -> Caret {
    var divider = NewBlock.make(.divider, id: makeID(), content: nil, pageDate: pageDate)
    divider.children = line.children
    let nextPath = Array(path.dropLast()) + [path[path.count - 1] + 1]
    let siblingCount = path.count == 1 ? blocks.count : self[Array(path.dropLast())].children.count
    if nextPath[nextPath.count - 1] < siblingCount {
      let next = self[nextPath]
      if next.type == "paragraph", InlineContent(next.content).isEmpty, next.children.isEmpty {
        self[path] = divider
        return Caret(block: next.id, offset: 0)
      }
    }
    let empty = NewBlock.make(.paragraph, id: makeID(), content: .array([]), pageDate: pageDate)
    modifySiblings(of: path) { list, index in
      list[index] = divider
      list.insert(empty, at: index + 1)
    }
    return Caret(block: empty.id, offset: 0)
  }
}
