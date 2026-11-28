/// `skippedDays` (`day-draft.ts:324-354`): per carried to-do, the days before `day` he skipped it from that day's
/// draft (✕ or Dismiss), oldest first; a to-do with none has no entry. A day is its draft's own day page's date. The
/// list starts again after the latest day he took the to-do on: applied from a draft, moved from one (`until`), or a
/// plan row of it on an earlier day page.
///
/// It reads the drafts the index parsed and, only when one holds a skip, the index's rows of the skipped to-dos; it
/// parses no document. Two readings differ from the web's at its edges: an `until` that is no calendar date reads as
/// absent here, where the web takes any truthy value, and a plan row counts only on a live page (the web would also
/// count one on a page in Trash, a template or a draft that shares a day page's id).
func skippedDays(in workspace: Workspace, index: TodoIndex, before day: LocalDate) -> [CodeUnitKey: [LocalDate]] {
  // `days.set` in page order: of two day pages of one id, the later wins.
  var days: [CodeUnitKey: LocalDate] = [:]
  for page in workspace.pages where page.type == "daily" && (page.trashedAt?.isEmpty ?? true) {
    guard let date = page.date, date < day else { continue }
    days[CodeUnitKey(page.id)] = date
  }
  var skips: [CodeUnitKey: (taskId: String, days: Set<LocalDate>)] = [:]
  var took: [CodeUnitKey: LocalDate] = [:]
  func tookOn(_ key: CodeUnitKey, _ on: LocalDate) {
    if took[key].map({ $0 < on }) ?? true { took[key] = on }
  }
  for stored in index.dayDrafts {
    guard let on = days[CodeUnitKey(stored.parentId ?? "")] else { continue }
    for item in stored.draft.items {
      guard let taskId = item.taskId, !taskId.isEmpty else { continue }
      let key = CodeUnitKey(taskId)
      if item.state == .applied || item.until != nil {
        tookOn(key, on)
      } else if item.state == .skipped {
        skips[key, default: (taskId, [])].days.insert(on)
      }
    }
  }
  if skips.isEmpty { return [:] }
  for (key, skipped) in skips {
    for row in index.rows(of: skipped.taskId) where row.role == .plan {
      if let on = days[CodeUnitKey(row.pageId)] { tookOn(key, on) }
    }
  }
  var out: [CodeUnitKey: [LocalDate]] = [:]
  for (key, skipped) in skips {
    let since = took[key]
    let list = skipped.days.filter { skip in since.map { $0 < skip } ?? true }.sorted()
    if !list.isEmpty { out[key] = list }
  }
  return out
}

/// A carried to-do's skipped days in words (`skippedLabel`, `src/components/draft-words.ts`).
public enum SkippedLabel {
  /// `skippedLabel` (`draft-words.ts`): `skipped Sat, Sun`; a day more than six days before `on` as `11/14`; four or
  /// more `skipped 5 times`. `full`: `skipped Sat 11/21, Sun 11/22`.
  public static func of(_ days: [LocalDate], on: LocalDate) -> (text: String, full: String) {
    let full = "skipped " + days.map(DayWords.shortLabel).joined(separator: ", ")
    if days.count > 3 { return ("skipped \(days.count) times", full) }
    let names = days.map { $0.days(to: on) > 6 ? "\($0.month)/\($0.day)" : DayWords.weekday($0) }
    return ("skipped " + names.joined(separator: ", "), full)
  }
}
