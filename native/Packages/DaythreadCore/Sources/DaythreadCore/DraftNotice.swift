/// Which way a person decided a suggestion.
public enum DraftDecision: Hashable, Sendable { case apply, skip }

/// What a skip's Undo acts on (`DraftTicket`, `draft-actions.ts`): the items, the skip that set them aside, and each
/// to-do's planned day as the notice was shown. The server refuses the reopen for what changed since.
public struct DraftTicket: Hashable, Sendable {
  public struct Seen: Hashable, Sendable {
    public let itemId: String
    public let plannedOn: LocalDate?

    public init(itemId: String, plannedOn: LocalDate?) {
      self.itemId = itemId
      self.plannedOn = plannedOn
    }
  }

  public let itemIds: [String]
  /// The skip's operation id.
  public let skippedBy: String
  /// One per skipped item with a `taskId`, in the draft's item order; a skipped line has none.
  public let seen: [Seen]

  public init(itemIds: [String], skippedBy: String, seen: [Seen]) {
    self.itemIds = itemIds
    self.skippedBy = skippedBy
    self.seen = seen
  }

  /// `draftTicket`: read from `draft` and `index` of the state that holds the skip's answer. The web reads each
  /// to-do's planned day before the skip; `skip-draft` changes no plan, so the two agree unless another device moved
  /// the to-do in between, when the app's reopen is accepted where the web's would be refused.
  public static func of(itemIds: [String], skippedBy: String, draft: DayDraft?, index: TodoIndex) -> DraftTicket {
    let seen = (draft?.items ?? []).compactMap { item -> Seen? in
      guard let taskId = item.taskId, !taskId.isEmpty, itemIds.contains(where: { $0.hasSameCodeUnits(as: item.id) })
      else { return nil }
      return Seen(itemId: item.id, plannedOn: index.plannedOn(taskId))
    }
    return DraftTicket(itemIds: itemIds, skippedBy: skippedBy, seen: seen)
  }
}

/// The words a draft action says (`draft-words.ts`).
public enum DraftNotice {
  public static func applied(_ count: Int) -> String { count == 1 ? "Applied" : "Applied \(count)" }
  public static func skipped(_ count: Int) -> String { count == 1 ? "Skipped" : "Skipped \(count)" }

  /// The server's count when its receipt reads `Applied` / `Applied N` (or `Skipped` / `Skipped N`): fewer than
  /// asked when some were done since. The web shows the asked count for a skip, because it draws the skip before the
  /// answer; the app waits for the answer, so it shows the server's count for both. A receipt that does not read as
  /// the decision, or none, says what was asked.
  public static func text(after decision: DraftDecision, receipt: Receipt?, asked: Int) -> String {
    let word = decision == .apply ? "Applied" : "Skipped"
    let make = decision == .apply ? applied : skipped
    guard let message = receipt?.message else { return make(asked) }
    if message.hasSameCodeUnits(as: word) { return make(1) }
    let prefix = word + " "
    if message.utf8.starts(with: prefix.utf8) {
      let digits = String(message.dropFirst(prefix.count))
      // No leading zero: the server writes `Applied 2`, never `Applied 02`.
      if digits.utf8.first != 0x30, digits.utf8.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }), let count = Int(digits), count >= 1 {
        return make(count)
      }
    }
    return make(asked)
  }

  public static let notApplied = "Not applied · changed elsewhere"
  public static let notSkipped = "Not skipped · changed elsewhere"
  /// A refused undo of an apply, or a refused reopen of a skip; a row's refused undo keeps `RowNotice.cantUndo`.
  public static let cantUndo = "Can't undo · edited since"
}
