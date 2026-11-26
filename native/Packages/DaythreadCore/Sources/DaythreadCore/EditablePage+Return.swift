/// Return, as the web's editor does it: BlockNote 0.56's Enter handling (`KeyboardShortcutsExtension.ts`
/// `handleEnter`, `splitBlock.ts`) and, in a to-do, the app's own handler (`page-editor.tsx`, the `task` Enter
/// branch). One difference, on purpose (spec §10.3): Return at the start of a to-do with words puts an empty
/// to-do above instead of moving the words to a new to-do, so a done or dated to-do keeps its words.
extension EditablePage {
  mutating func pressReturn(at caret: Caret) -> Caret? {
    guard let path = editablePath(of: caret.block) else { return nil }
    let block = self[path]
    let words = InlineContent(block.content)
    let (before, after) = words.split(at: caret.offset)

    if block.type == "task" { return returnInToDo(block, at: path, before: before, after: after) }
    if words.isEmpty { return returnOnEmptyLine(block, at: path) }
    if before.isEmpty {
      // The line itself, with its id, props and children, stays where it is.
      let above = NewBlock.make(Self.continuation(of: block.type), id: makeID(), content: .array([]), pageDate: pageDate)
      modifySiblings(of: path) { list, index in list.insert(above, at: index) }
      return Caret(block: block.id, offset: 0)
    }
    return split(block, at: path, before: before, after: after)
  }

  /// The first half keeps the id, type and props; the second is a new block with the web's props for its kind
  /// and the nested lines, as `tr.split` leaves them.
  private mutating func split(_ block: Block, at path: Path, before: InlineContent, after: InlineContent) -> Caret {
    var first = block
    first.content = before.json
    first.children = []
    var second = NewBlock.make(Self.continuation(of: block.type), id: makeID(), content: after.json, pageDate: pageDate)
    second.children = block.children
    modifySiblings(of: path) { list, index in
      list[index] = first
      list.insert(second, at: index + 1)
    }
    return Caret(block: second.id, offset: 0)
  }

  private mutating func returnOnEmptyLine(_ block: Block, at path: Path) -> Caret {
    switch block.type {
    case "bulletListItem", "numberedListItem":
      // `emptyEnterResets`: the item becomes a paragraph where it is, and its children stay.
      self[path] = Self.asParagraph(block)
      return Caret(block: block.id, offset: 0)
    default:
      if path.count > 1 {
        outdent(at: path)
        return Caret(block: block.id, offset: 0)
      }
      var next = NewBlock.make(.paragraph, id: makeID(), content: .array([]), pageDate: pageDate)
      next.children = block.children
      var emptied = block
      emptied.children = []
      modifySiblings(of: path) { list, index in
        list[index] = emptied
        list.insert(next, at: index + 1)
      }
      return Caret(block: next.id, offset: 0)
    }
  }

  /// BlockNote's `liftItem` (`nestBlock.ts`), which Shift-Tab also uses: the block becomes the next sibling of
  /// its parent, and the lines after it at its old level come under it, after its own children.
  private mutating func outdent(at path: Path) {
    let parent = Array(path.dropLast())
    let lifted: Block = modifyChildren(of: parent) { siblings in
      let index = path[path.count - 1]
      var block = siblings[index]
      block.children += siblings[(index + 1)...]
      siblings.removeSubrange(index...)
      return block
    }
    modifySiblings(of: parent) { list, index in list.insert(lifted, at: index + 1) }
  }

  private mutating func returnInToDo(_ row: Block, at path: Path, before: InlineContent, after: InlineContent)
    -> Caret
  {
    if before.isEmpty && after.isEmpty {
      // The web's `updateBlock(…, { type: 'paragraph' })`: no to-do is made, and the line keeps its place.
      self[path] = Self.asParagraph(row)
      return Caret(block: row.id, offset: 0)
    }
    let id = makeID()
    if before.isEmpty {
      let above = Block(id: id, type: "task", props: Self.todoProps(copying: row.props, id: id), content: .array([]))
      modifySiblings(of: path) { list, index in list.insert(above, at: index) }
      return Caret(block: row.id, offset: 0)
    }
    // `insertBlocks(…, row.id, 'after')`: after the row and everything nested under it, which stays with the row.
    var first = row
    first.content = before.json
    let next = Block(id: id, type: "task", props: Self.todoProps(copying: row.props, id: id), content: after.json)
    modifySiblings(of: path) { list, index in
      list[index] = first
      list.insert(next, at: index + 1)
    }
    return Caret(block: id, offset: 0)
  }

  /// The kind a line continues as: a list item as the same kind (a numbered item without `start`, so it counts on),
  /// anything else as a paragraph (`keyboard.splitKeepsType`).
  private static func continuation(of type: String) -> NewBlock.Kind {
    switch type {
    case "bulletListItem": .bullet
    case "numberedListItem": .numbered(start: nil)
    default: .paragraph
    }
  }

  /// The block as a paragraph, as BlockNote's type change writes it: the props a paragraph has, each keeping the
  /// value the block had (a bullet's colour stays), the others dropped (`start`, a to-do's `taskId`).
  static func asParagraph(_ block: Block) -> Block {
    var paragraph = block
    paragraph.type = "paragraph"
    var props = NewBlock.make(.paragraph, id: block.id, content: nil, pageDate: nil).props
    for key in props.keys { if let value = block.props[key] { props[key] = value } }
    paragraph.props = props
    return paragraph
  }

  /// A new to-do from a row, as the web's `{ ...block.props, taskId }`: the row's role and plan date, its own task.
  /// The props are the `task` spec's, in its order, with its defaults for any the row lacks.
  private static func todoProps(copying row: JSONObject, id: String) -> JSONObject {
    [
      "taskId": .string("editor-task:\(id)"),
      "role": row["role"] ?? .string("reference"),
      "planDate": row["planDate"] ?? .string(""),
    ]
  }
}
