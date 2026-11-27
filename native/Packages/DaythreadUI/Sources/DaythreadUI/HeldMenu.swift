import DaythreadCore
import DaythreadSync

/// What the held button's menu says: one section per draft kept and not sent, one per held change, titled with the
/// web's sentence for why it was not saved (`HeldBanner` in `src/components/app-shell.tsx`), and a last line for the
/// changes waiting behind them.
enum HeldMenu {
  struct Section: Equatable {
    let id: Int
    let title: String
    let canKeep: Bool
  }

  /// A draft the engine keeps and does not send until he acts (`native-phase-1.md` §10.6): its page is gone or in
  /// Trash, or the server would not take it. Its section holds "Copy draft" and "Discard draft".
  struct DraftSection: Equatable {
    let pageId: String
    let title: String
  }

  static func sections(_ held: [HeldChange]) -> [Section] {
    held.map { Section(id: $0.id, title: title(for: $0), canKeep: $0.canKeep) }
  }

  /// One section per stuck draft, titled with its page's day and why it is not sent; the reason alone when the copy
  /// no longer has the page.
  static func draftSections(_ drafts: [DraftStatus], in workspace: Workspace?) -> [DraftSection] {
    drafts.compactMap { draft in
      guard case .stuck(let reason) = draft.state else { return nil }
      let day = workspace?.page(draft.id)?.date.map { DayTitle.short(for: $0) }
      return DraftSection(pageId: draft.id, title: [day, reason].compactMap(\.self).joined(separator: " · "))
    }
  }

  static func waitingLine(_ waiting: Int) -> String? {
    switch waiting {
    case ...0: nil
    case 1: "1 later change waiting"
    default: "\(waiting) later changes waiting"
    }
  }

  private static func title(for change: HeldChange) -> String {
    let label = change.label
    return switch change.reason {
    case .conflict: "Not saved — \(label) was changed elsewhere"
    case .changedSince: "Not saved — \(label) · changed since"
    case .maybeApplied: "Not saved? — \(label) may already be in"
    case .gone: "Not saved — \(quotedName(in: label) ?? "it") was deleted elsewhere"
    case .refused: "Not saved — can't do this now: \(label)"
    }
  }

  /// The first quoted run in the label, quotes included: the thing's name without the verb (the web's `/"[^"]*"/`).
  private static func quotedName(in label: String) -> String? {
    guard let open = label.firstIndex(of: "\"") else { return nil }
    let rest = label[label.index(after: open)...]
    guard let close = rest.firstIndex(of: "\"") else { return nil }
    return String(label[open...close])
  }
}
