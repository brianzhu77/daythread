import Foundation

/// A page's unsaved text, kept on the device: one per page and account. Every string is kept as given, byte for byte.
public struct PageDraft: Sendable, Equatable {
  /// The save on its way, kept until it is answered so that a retry is the same request and the answer can be
  /// merged against what was sent.
  public struct Sent: Sendable, Equatable {
    public var operationId: String
    /// The exact document sent: the one in `action`.
    public var document: String
    /// The whole action as first sent, as `JSON.write` gave it. The server replays an operation only for the same
    /// action, so every try sends this text again rather than an action built anew (its `at`, `today` and rows
    /// removed would differ).
    public var action: String

    public init(operationId: String, document: String, action: String) {
      self.operationId = operationId
      self.document = document
      self.action = action
    }
  }

  public var pageId: String
  public var owner: String
  /// The content key of `baseDocument`.
  public var base: String
  /// The page's document as the draft last started from or was last merged onto.
  public var baseDocument: String
  public var document: String
  public var singleDeleteIds: [String]
  public var sent: Sent?
  public var changedAt: Date

  public init(
    pageId: String, owner: String, base: String, baseDocument: String, document: String,
    singleDeleteIds: [String], sent: Sent?, changedAt: Date
  ) {
    self.pageId = pageId
    self.owner = owner
    self.base = base
    self.baseDocument = baseDocument
    self.document = document
    self.singleDeleteIds = singleDeleteIds
    self.sent = sent
    self.changedAt = changedAt
  }
}

extension PageDraft {
  /// The order `WorkspaceStore.drafts()` answers in: oldest change first, ties by owner then page id.
  /// Strings compare by code units, as ids do in the domain.
  static func inStoreOrder(_ a: PageDraft, _ b: PageDraft) -> Bool {
    if a.changedAt != b.changedAt { return a.changedAt < b.changedAt }
    if a.owner != b.owner { return a.owner.utf8.lexicographicallyPrecedes(b.owner.utf8) }
    return a.pageId.utf8.lexicographicallyPrecedes(b.pageId.utf8)
  }
}
