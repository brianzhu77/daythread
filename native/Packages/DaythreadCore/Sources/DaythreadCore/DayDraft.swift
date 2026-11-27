/// A day's draft as far as "Since" needs it (`DayDraft` in `src/domain/day-draft.ts`): which to-dos it applied. The
/// draft is a hidden page `draft:<day page id>` whose document is an object, not blocks.
struct DayDraft {
  let appliedTaskIds: Set<CodeUnitKey>

  /// Nil when the document is not a JSON object. An item that is not an object, or has no string `taskId`, is skipped.
  init?(document: String) {
    guard let object = (try? JSON.parse(document))?.objectValue else { return nil }
    var applied = Set<CodeUnitKey>()
    for item in object["items"]?.arrayValue ?? [] {
      guard let item = item.objectValue, item["state"]?.stringValue?.hasSameCodeUnits(as: "applied") == true,
        let taskId = item["taskId"]?.stringValue
      else { continue }
      applied.insert(CodeUnitKey(taskId))
    }
    appliedTaskIds = applied
  }
}

extension Workspace {
  /// `draftPageId`: the id of the page that holds a day page's draft.
  static func draftPageId(of dayPageId: String) -> String { "draft:\(dayPageId)" }
}
