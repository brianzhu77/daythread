import DaythreadCore

/// What he asked of a row. The list knows no commands: it reports, and its host does the rest.
public struct RowRequest: Sendable, Equatable {
  public enum Kind: Sendable, Equatable { case action(RowAction), more }
  public let kind: Kind
  public let rowID: String
  public let taskId: String
  /// The row's menu when he asked, so the host builds `More`'s sheet from what he saw.
  public let menu: RowMenu

  public init(kind: Kind, rowID: String, taskId: String, menu: RowMenu) {
    self.kind = kind
    self.rowID = rowID
    self.taskId = taskId
    self.menu = menu
  }
}
