import DaythreadCore

/// One line of a drawn page: a block, flattened, with what a cell needs to draw it.
public struct BlockRow: Hashable, Sendable, Identifiable {
  /// How a text row is set.
  public enum TextStyle: Hashable, Sendable {
    case paragraph
    /// 1 to 3.
    case heading(level: Int)
    case bullet
    /// Counted from 1 within a run of numbered siblings.
    case numbered(Int)
    case quote
  }

  public enum Kind: Hashable, Sendable {
    case text(style: TextStyle)
    /// `taskId` is the block's `props.taskId` (empty when it has none). `status` is nil for a row whose
    /// task the workspace does not hold yet. `facts` is what the row draws under its words; nil when the rows were
    /// drawn without a today (`BlockRows.rows(for:in:today:)`).
    case todo(taskId: String, status: TodoTask.Status?, paused: Bool, facts: RowFacts?)
    case separator
    /// A block this version does not draw, by the name it is shown under.
    case placeholder(name: String)
  }

  /// The block's id; unique within a page's rows (see `BlockRows`).
  public let id: String
  public let kind: Kind
  public let depth: Int
  /// The block's inline content. Nil for a separator and a placeholder.
  public let content: JSONValue?

  public init(id: String, kind: Kind, depth: Int, content: JSONValue?) {
    self.id = id
    self.kind = kind
    self.depth = depth
    self.content = content
  }

  /// A to-do whose task is open or done: the two states a tap can flip. A cancelled or unknown task, and a
  /// to-do the workspace does not hold, cannot be ticked.
  public var canBeTicked: Bool {
    guard case .todo(_, let status, _, _) = kind else { return false }
    return status == .open || status == .done
  }

  /// The row as it would be drawn without a today: what typing can change of a row, since its facts are read from its
  /// to-do and the workspace, never from its words.
  var withoutFacts: BlockRow {
    guard case .todo(let taskId, let status, let paused, .some) = kind else { return self }
    return BlockRow(id: id, kind: .todo(taskId: taskId, status: status, paused: paused, facts: nil), depth: depth, content: content)
  }
}
