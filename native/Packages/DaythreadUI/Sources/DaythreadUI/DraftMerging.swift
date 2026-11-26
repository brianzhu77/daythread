import DaythreadCore
import DaythreadSync

/// The merge of a draft that is behind the server's page (`native-phase-1.md` §10.6), run without asking him: the open
/// page's by the day screen, with its words as they are at that moment; another page's by the model, with the stored
/// draft's. The result becomes his draft on the server's page (`SyncEngine.rebaseDraft`).
enum DraftMerging {
  /// What to do for a draft that is behind: the merged document and whether to say so.
  static func merged(draft: PageDraft, mine: String, theirs: String) -> PageMerge.Merged {
    merged(base: draft.baseDocument, mine: mine, theirs: theirs)
  }

  /// `base` is the page the draft started from, as `SyncEngine.merging` reads it with `theirs`.
  static func merged(base: String, mine: String, theirs: String) -> PageMerge.Merged {
    PageMerge.merge(base: base, mine: mine, theirs: theirs)
  }

  /// A draft's words as plain text, one line per row he can type into, in page order: what "Copy draft" copies.
  static func plainText(of document: String, pageDate: LocalDate?) -> String {
    let page = EditablePage(document: document, pageDate: pageDate)
    return page.textBlocks.compactMap { page.content(of: $0)?.plain }.joined(separator: "\n")
  }
}
