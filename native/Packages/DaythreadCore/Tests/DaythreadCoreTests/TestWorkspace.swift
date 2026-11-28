import Testing

@testable import DaythreadCore

/// Small workspaces for the tests that a shared case does not reach: pages with the rows a test needs.
enum TestWorkspace {
  static func row(_ taskId: String, role: String? = "plan", children: [Block] = []) -> Block {
    var props: JSONObject = ["taskId": .string(taskId)]
    if let role { props["role"] = .string(role) }
    return Block(id: "row:\(taskId):\(role ?? "none")", type: "task", props: props, children: children)
  }

  static func page(
    _ id: String, type: String = "document", date: String? = nil, parentId: String? = nil,
    trashedAt: String? = nil, document: String
  ) -> JSONValue {
    .object([
      "id": .string(id), "type": .string(type), "date": date.map { .string($0) } ?? .null,
      "title": .string(id), "document": .string(document),
      "parentId": parentId.map { .string($0) } ?? .null,
      "trashedAt": trashedAt.map { .string($0) } ?? .null,
    ])
  }

  static func day(_ date: String, rows: [Block], trashedAt: String? = nil) -> JSONValue {
    page("day:\(date)", type: "daily", date: date, trashedAt: trashedAt, document: Document.write(rows))
  }

  /// The day's draft: a hidden page under its day page whose document is an object.
  static func draft(of dayPageId: String, applied taskIds: [String], trashedAt: String? = nil) -> JSONValue {
    let items = taskIds.enumerated().map { index, id -> JSONValue in
      .object(["id": .string("i\(index)"), "taskId": .string(id), "state": .string("applied")])
    }
    let document = JSON.write(.object(["status": .string("ready"), "items": .array(items), "moreOpen": .array([])]))
    return page("draft:\(dayPageId)", type: "draft", trashedAt: trashedAt, document: document)
  }

  static func task(
    _ id: String, title: String = "A to-do", status: String = "open", paused: Bool = false,
    createdOn: String? = nil
  ) -> JSONValue {
    var object: JSONObject = [
      "id": .string(id), "title": .string(title), "status": .string(status), "version": .number("1"),
      "paused": .bool(paused), "deadlineOn": .null, "attentionOn": .null,
    ]
    if let createdOn { object["createdOn"] = .string(createdOn) }
    return .object(object)
  }

  static func make(
    pages: [JSONValue] = [], tasks: [JSONValue] = [], rest: [(String, JSONValue)] = []
  ) throws -> Workspace {
    var object: JSONObject = [
      "revision": .number("1"), "timezone": .string("America/Vancouver"), "pages": .array(pages),
      "tasks": .array(tasks),
    ]
    for (key, value) in rest { object[key] = value }
    return try #require(Workspace(.object(object)))
  }

  static func repeatRecord(
    id: String = "r1", taskId: String, every: String = "week", interval: JSONValue = .number("1"),
    from: String = "schedule", weekdays: JSONValue? = nil
  ) -> JSONValue {
    var object: JSONObject = [
      "id": .string(id), "taskId": .string(taskId), "slot": .string("2026-11-26"),
      "start": .string("2026-11-26"), "every": .string(every), "interval": interval, "from": .string(from),
      "createdAt": .string("2026-11-26T09:00:00.000Z"),
    ]
    if let weekdays { object["weekdays"] = weekdays }
    return .object(object)
  }

  static func link(blocked: String, blocker: String) -> JSONValue {
    .object([
      "blockedId": .string(blocked), "blockerId": .string(blocker),
      "createdAt": .string("2026-11-26T09:00:00.000Z"),
    ])
  }
}
