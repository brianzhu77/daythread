extension Block {
  /// `isTaskRow` (`editor-document.ts:58`): a `task` whose `taskId` is a string, empty or not.
  var isTaskRow: Bool { type == "task" && props["taskId"]?.stringValue != nil }

  /// `isEmptyLine` (`editor-document.ts:68`): not a page link, heading, button, smart note, image or file; no words
  /// (`String#trim`), no inline item that is not text, no children.
  var isEmptyLine: Bool {
    switch type {
    case "pageLink", "heading", "button", "smartNote", "image", "file": return false
    default: break
    }
    guard children.isEmpty, Workspace.isBlankInJavaScript(InlineText.plain(content, pageDate: nil)) else { return false }
    // `c && typeof c === 'object' && c.type !== 'text'`: an array is an object to `typeof`; null and a scalar are not.
    for item in content?.arrayValue ?? [] {
      switch item {
      case .object(let object):
        if object["type"]?.stringValue?.hasSameCodeUnits(as: "text") != true { return false }
      case .array: return false
      default: continue
      }
    }
    return true
  }

  /// This block and every block under it, depth first (`flatNodes`, `editor-document.ts:57`).
  var flattened: [Block] { [self] + children.flatMap(\.flattened) }
}
