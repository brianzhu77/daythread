/// Tab and Shift-Tab: BlockNote 0.56's `nestBlock` and `liftItem` (`nestBlock.ts`), with the app's `canIndent`
/// (`page-editor.tsx`). The caret keeps its place in the words.
extension EditablePage {
  /// The line becomes the last nested line of the line before it, with its own nested lines. Not on a heading,
  /// not right under one (a section's line would leave its section), not on the first line of its group, and not
  /// under a block the app does not draw the inside of, where the line would vanish or be written into a shared
  /// block.
  mutating func indent(at caret: Caret) -> Caret? {
    guard let path = editablePath(of: caret.block) else { return nil }
    let index = path[path.count - 1]
    guard index > 0 else { return nil }
    let previous = self[Array(path.dropLast()) + [index - 1]]
    guard self[path].type != "heading", previous.type != "heading", Self.drawnTypes.contains(previous.type) else {
      return nil
    }
    modifySiblings(of: path) { list, index in
      let line = list.remove(at: index)
      list[index - 1].children.append(line)
    }
    return caret
  }

  /// The line moves out one level, and the lines after it at its old level come under it (`liftItem`, as an
  /// empty nested line's Return does).
  mutating func unindent(at caret: Caret) -> Caret? {
    guard let path = editablePath(of: caret.block), path.count > 1 else { return nil }
    outdent(at: path)
    return caret
  }
}
