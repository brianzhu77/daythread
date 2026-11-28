/// A row of the page's list that is not a line of the page's document: the caret never enters it, it is not saved,
/// selected, copied, dragged or counted as a line. The host says where it goes and what it shows; the list knows
/// nothing of what it stands for and reports which of its actions was used.
public struct GuestRow: Hashable, Sendable {
  /// The row it is drawn as: the column its words take, and its leading mark.
  public enum Kind: Hashable, Sendable {
    /// In a to-do's column, a dashed circle where a to-do has its circle.
    case todo
    /// In a bullet's column, a small dashed dot where a bullet has its dot.
    case bullet
    /// As a paragraph, with no mark.
    case line
  }

  public enum Place: Hashable, Sendable {
    /// After the line (a row of the list) of that id; nil: before the page's first line.
    case after(lineID: String?)
    // 1d.2b adds `case replacing(lineID: String)`; nothing here may assume `after` is the only case forever.
  }

  /// A trailing button: a system symbol, its label (`Apply Buy milk`, for Voice Control and Full Keyboard Access),
  /// and the name of the row's custom action for VoiceOver (`Apply`). 1d.3 adds a menu, and a tap on the row.
  public struct Action: Hashable, Sendable {
    public let id: String
    public let symbol: String
    public let label: String
    public let spokenName: String

    public init(id: String, symbol: String, label: String, spokenName: String) {
      self.id = id
      self.symbol = symbol
      self.label = label
      self.spokenName = spokenName
    }
  }

  public let id: String
  public let place: Place
  public let kind: Kind
  /// The column it is drawn in, as a line's depth.
  public let depth: Int
  public let words: String
  /// The small text under the words (`Thu 11/19`); "" for none.
  public let detail: String
  /// The small text as VoiceOver reads it; nil: as shown.
  public let spokenDetail: String?
  /// What VoiceOver calls this kind of row, read before its words (`Suggestion`). The host's word: the list has
  /// none of its own for a guest.
  public let spokenKind: String
  public let actions: [Action]

  public init(
    id: String, place: Place, kind: Kind, depth: Int = 0, words: String, detail: String,
    spokenDetail: String? = nil, spokenKind: String, actions: [Action]
  ) {
    self.id = id
    self.place = place
    self.kind = kind
    self.depth = depth
    self.words = words
    self.detail = detail
    self.spokenDetail = spokenDetail
    self.spokenKind = spokenKind
    self.actions = actions
  }

  /// How VoiceOver reads the row: `<spokenKind>, <words>, <small text>`, the small text left out when there is none.
  var spokenLabel: String {
    let small = spokenDetail ?? detail
    return ([spokenKind, words] + (small.isEmpty ? [] : [small])).joined(separator: ", ")
  }
}

/// Internal: an item of the list, a line (a row of `BlockRows`) or a guest; a guest's id is never read as a line's.
enum ListItem: Hashable, Sendable {
  case line(String)
  case guest(String)

  /// The list's items: the lines in order, each guest after its line (several on one line in the order given; those
  /// placed before the first line first). A guest whose line is not among `lines` is not drawn.
  static func items(lines: [String], guests: [GuestRow]) -> [ListItem] {
    guard !guests.isEmpty else { return lines.map(ListItem.line) }
    var leading: [ListItem] = []
    var after: [String: [ListItem]] = [:]
    for guest in guests {
      switch guest.place {
      case .after(nil): leading.append(.guest(guest.id))
      case .after(let lineID?): after[lineID, default: []].append(.guest(guest.id))
      }
    }
    var items = leading
    items.reserveCapacity(lines.count + guests.count)
    for line in lines {
      items.append(.line(line))
      if let guests = after[line] { items.append(contentsOf: guests) }
    }
    return items
  }
}
