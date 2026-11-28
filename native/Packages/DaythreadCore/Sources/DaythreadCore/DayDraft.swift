/// A day's draft (`DayDraft`, `src/domain/day-draft.ts:12-40`): the hidden page `draft:<day page id>`, whose document
/// is an object, not blocks. Beyond parsing the web checks no shape, so a field of the wrong kind reads as absent.
public struct DayDraft: Hashable, Sendable {
  /// Anything but the three words the web writes reads as `unknown`, which is no one of them.
  public enum Status: Hashable, Sendable { case preparing, ready, failed, unknown }

  /// One suggestion (`DraftItem`, `day-draft.ts:15-35`).
  public struct Item: Hashable, Sendable {
    /// `fill` only for exactly "fill", as `item.place === 'fill'`.
    public enum Place: Hashable, Sendable { case fill, after }
    /// An absent state is not `open` (`state !== 'open'` settles a draft), so it is `unknown`, not `open`.
    public enum State: Hashable, Sendable { case open, applied, skipped, unknown }

    /// "" when absent.
    public let id: String
    /// "" when absent: no anchor.
    public let anchor: String
    public let place: Place
    public let taskId: String?
    /// Read as `Document.blocks` reads a block; one that does not read is absent.
    public let block: Block?
    public let state: State
    public let until: LocalDate?
    public let by: String?
    /// Nil for "": the web tests its truth.
    public let from: String?
    public let since: LocalDate?
    public let recipe: Int?
    public let took: [String]
    /// Nil for "".
    public let row: String?

    /// `sameWords(inlineText(block.content))`; nil without a block.
    var words: String? {
      block.map { sameWords(InlineText.plain($0.content, pageDate: nil)) }
    }

    init(_ object: JSONObject) {
      id = object["id"]?.stringValue ?? ""
      anchor = object["anchor"]?.stringValue ?? ""
      place = object["place"]?.stringValue?.hasSameCodeUnits(as: "fill") == true ? .fill : .after
      taskId = object["taskId"]?.stringValue
      block = object["block"].flatMap(Block.init)
      state = Self.state(object["state"]?.stringValue)
      until = object["until"]?.stringValue.flatMap(LocalDate.init)
      by = object["by"]?.stringValue
      from = Self.nonEmpty(object["from"])
      since = object["since"]?.stringValue.flatMap(LocalDate.init)
      recipe = object["recipe"]?.intValue
      took = (object["took"]?.arrayValue ?? []).compactMap(\.stringValue)
      row = Self.nonEmpty(object["row"])
    }

    private static func state(_ word: String?) -> State {
      guard let word else { return .unknown }
      if word.hasSameCodeUnits(as: "open") { return .open }
      if word.hasSameCodeUnits(as: "applied") { return .applied }
      if word.hasSameCodeUnits(as: "skipped") { return .skipped }
      return .unknown
    }

    private static func nonEmpty(_ value: JSONValue?) -> String? {
      guard let text = value?.stringValue, !text.isEmpty else { return nil }
      return text
    }
  }

  public let status: Status
  public let items: [Item]
  public let moreOpen: [String]
  /// Nil when absent: read as 1 (`recipeOf`).
  public let recipe: Int?
  /// The to-dos it applied (1c's `Since` reads it).
  let appliedTaskIds: Set<CodeUnitKey>

  /// `DRAFT_RECIPE` (`day-draft.ts:56`), held to the web's by `fixtures/core/draft/recipe.json`.
  public static let currentRecipe = 5

  /// Nil when the document does not parse (`draftOf`'s `catch`) or is not an object: an array or a number is no draft
  /// here, where the web would hand it on unread.
  public init?(document: String) {
    guard let object = (try? JSON.parse(document))?.objectValue else { return nil }
    status = Self.status(object["status"]?.stringValue)
    items = (object["items"]?.arrayValue ?? []).compactMap { $0.objectValue.map(Item.init) }
    moreOpen = (object["moreOpen"]?.arrayValue ?? []).compactMap(\.stringValue)
    recipe = object["recipe"]?.intValue
    appliedTaskIds = Set(
      items.lazy.filter { $0.state == .applied }.compactMap(\.taskId).map(CodeUnitKey.init))
  }

  private static func status(_ word: String?) -> Status {
    guard let word else { return .unknown }
    if word.hasSameCodeUnits(as: "preparing") { return .preparing }
    if word.hasSameCodeUnits(as: "ready") { return .ready }
    if word.hasSameCodeUnits(as: "failed") { return .failed }
    return .unknown
  }

  /// `draftSettled` (`day-draft.ts:63`): the day's draft for good, a ready one or one he already acted on.
  public var settled: Bool { status == .ready || items.contains { $0.state != .open } }

  /// `draftStale` (`day-draft.ts:65`): settled, and made by an older recipe.
  public var stale: Bool { settled && (recipe ?? 1) < Self.currentRecipe }
}

extension Workspace {
  /// `draftPageId`: the id of the page that holds a day page's draft.
  static func draftPageId(of dayPageId: String) -> String { "draft:\(dayPageId)" }
}
