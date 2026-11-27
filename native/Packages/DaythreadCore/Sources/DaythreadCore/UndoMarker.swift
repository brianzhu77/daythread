/// The server's one Undo slot as the browser gets it (`undo` of the workspace, without the copy the server keeps).
public struct UndoMarker: Hashable, Sendable {
  public let operationId: String
  public let revision: Int

  init?(_ json: JSONValue?) {
    guard let object = json?.objectValue, let operationId = object["operationId"]?.stringValue,
      let revision = object["revision"]?.intValue
    else { return nil }
    self.operationId = operationId
    self.revision = revision
  }

  public init(operationId: String, revision: Int) {
    self.operationId = operationId
    self.revision = revision
  }
}

extension Workspace {
  /// `undo` of the workspace; nil when absent, null or unreadable.
  public var undoMarker: UndoMarker? { UndoMarker(rest["undo"]) }
}
