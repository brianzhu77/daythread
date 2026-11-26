/// The three-way merge of a page (spec §10.6), run without asking him when the server's page changed while he typed.
///
/// Neither side replaces the other, and he is not asked. Three versions are known: the page the draft started from
/// (`base`), his draft (`mine`), and the page as the server now has it (`theirs`). They are merged line by line, by
/// line id, at any depth.
///
/// | The line                            | In the merged page                                                     |
/// |-------------------------------------|------------------------------------------------------------------------|
/// | Changed only by him                 | His                                                                    |
/// | Changed only on the server          | The server's                                                           |
/// | Changed by both to the same words   | Those words, once                                                      |
/// | Changed by both, differently        | The server's stays, and his words go in as a new line right below it   |
/// | Added by him                        | After the line it followed in his draft, or the nearest line before    |
/// |                                     | that which still exists                                                |
/// | Added on the server                 | Where the server has it                                                |
/// | Deleted by him, untouched on server | Deleted                                                                |
/// | Deleted by him, changed on server   | The server's line stays                                                |
/// | Deleted on the server, untouched    | Deleted                                                                |
/// | Deleted on the server, changed by   | His words go back in where the line was                                |
/// | him                                 |                                                                        |
///
/// - To-dos. A to-do's row is a line like any other, and its `taskId` travels with it. When both changed a to-do's
///   words, the server's row keeps the to-do and his words go below it as a plain line: one to-do must not become
///   two. When the server deleted a to-do's row and he changed its words, his words go back in where the row was as
///   a plain line, without the `taskId`.
/// - Nesting and order. If only one side moved or nested lines, that side's arrangement is kept and the other's
///   words and added lines are fitted into it. If both rearranged, the server's arrangement is kept and his words,
///   additions and deletions are applied to it.
/// - What must always hold: merging with an unchanged server page gives his draft exactly; merging an unchanged
///   draft gives the server's page exactly; when both made the same change the result is that change; and every
///   line's words that either side wrote and the other did not delete are in the result.
///
/// How the rules are read here:
/// - A line's fields are its `type`, its `content`, each key of its `props` on its own, and any other key of its
///   node but `id` and `children`. A line is changed when some field differs from the base's. A line both sides
///   changed is merged field by field: a field only one side changed is that side's, one both set to the same value
///   is that value, and a key one side added or removed while the other left it is added or removed. Only when some
///   field was changed by both, differently, is the line "changed by both, differently": the server's line stays and
///   his whole line as he has it now goes below. Otherwise it is one line, built on the server's node in its key
///   order with his fields set and his new keys after the server's; when only one side changed anything it is that
///   side's line exactly as read.
/// - The server stamps `at` on each `pageRef` in a line's words that has none (`workspace.ts`). A stamp is not a
///   change of words: when the server's `content` differs from the base's only by stamps and he changed the words,
///   his words are kept, each `pageRef` of his without `at` taking the server's stamped one that is otherwise the
///   same (the first not yet taken, in order).
/// - A line he puts back or adds goes after the nearest earlier line before it at its own level that is still
///   there (its last surviving nested line, when the line itself is gone); with none, first under its parent; and
///   under a parent that is gone, where that parent would go. Keeping its level this way keeps the page order of a
///   line added after a nested list; when the other side nested the line before it, it is nested with it, which
///   costs him one Shift-Tab. His line below the server's sits right after the server's line and what is nested
///   under it, at its depth, with a fresh id and no nested lines.
/// - A block the app does not draw (a database, a synced block, a page link, anything `EditablePage` does not edit)
///   is decided by the server's version alone: the server's, with everything under it as the server has it, and
///   gone when the server no longer has it. A block that is undrawn only in his draft is a line he did not change.
/// - A side "rearranged" when the lines it shares with the base are in another order, or under another of those
///   lines, than in the base. Deleting a line, whose nested lines take its place, is not a rearrangement.
/// - A page that does not parse is never read as an empty page: an unreadable server page leaves his draft, an
///   unreadable draft leaves the server's page, and an unreadable base is merged as if nothing were known of it, so
///   every line of either side is kept.
/// - No block id appears twice in the result: a repeated id is given a fresh one, never one of a block the app does
///   not draw. No `taskId` is on two rows either: the server's row keeps it, and another row carrying it becomes a
///   plain line with its words.
public enum PageMerge {
  public struct Merged: Sendable, Equatable {
    public let document: String
    /// Some line was changed by both, differently: his words were put below the server's.
    public let bothChanged: Bool
  }

  /// `base`: the page the draft started from. `mine`: the draft. `theirs`: the page as the server has it now.
  public static func merge(
    base: String, mine: String, theirs: String, makeID: @Sendable () -> String = NewBlock.id
  ) -> Merged {
    guard let theirsBlocks = Version.read(theirs) else { return Merged(document: mine, bothChanged: false) }
    guard let mineBlocks = Version.read(mine) else { return Merged(document: theirs, bothChanged: false) }
    if theirs.hasSameCodeUnits(as: base), !Version(mineBlocks).repeatsAnID {
      return Merged(document: mine, bothChanged: false)
    }
    if mine.hasSameCodeUnits(as: base) || mine.hasSameCodeUnits(as: theirs), !Version(theirsBlocks).repeatsAnID {
      return Merged(document: theirs, bothChanged: false)
    }
    let merged = mergeLineByLine(base: base, mine: mine, theirs: theirs, makeID: makeID)
    // A merge that comes to one side's page gives that page as it was stored, not rewritten.
    if merged.document.hasSameCodeUnits(as: Document.write(theirsBlocks)) {
      return Merged(document: theirs, bothChanged: false)
    }
    if merged.document.hasSameCodeUnits(as: Document.write(mineBlocks)) {
      return Merged(document: mine, bothChanged: false)
    }
    return merged
  }

  /// The merge without the short cuts of `merge`, its document as written: what `merge` runs when no short cut
  /// applies, and what the tests hold to the same rules.
  static func mergeLineByLine(
    base: String, mine: String, theirs: String, makeID: @Sendable () -> String
  ) -> Merged {
    guard let theirsBlocks = Version.read(theirs) else { return Merged(document: mine, bothChanged: false) }
    guard let mineBlocks = Version.read(mine) else { return Merged(document: theirs, bothChanged: false) }
    let result = withoutActuallyEscaping(makeID) { makeID in
      var merger = Merger(
        base: Version(Version.read(base) ?? []), mine: Version(mineBlocks), theirs: Version(theirsBlocks),
        makeID: makeID)
      return merger.run()
    }
    return Merged(document: Document.write(result.blocks), bothChanged: result.bothChanged)
  }
}

// MARK: - One version, by line id

extension PageMerge {
  /// A page's lines by id, as `EditablePage` sees them: a block the app does not draw is a line, and what is under
  /// it is not looked at. A repeated id is read at its first place.
  fileprivate struct Version {
    struct Line {
      let block: Block
      let parent: String?
    }

    let blocks: [Block]
    private(set) var lines: [String: Line] = [:]
    /// Line ids in page order.
    private(set) var order: [String] = []
    private(set) var children: [String?: [String]] = [:]
    /// Every block id at any depth, under undrawn blocks too.
    private(set) var everyID: Set<String> = []
    private(set) var repeatsAnID = false

    static func read(_ document: String) -> [Block]? {
      Document.parses(document) ? Document.blocks(document) : nil
    }

    init(_ blocks: [Block]) {
      self.blocks = blocks
      index(blocks, under: nil)
    }

    private mutating func index(_ list: [Block], under parent: String?) {
      for block in list {
        if !everyID.insert(block.id).inserted { repeatsAnID = true }
        if lines[block.id] == nil {
          lines[block.id] = Line(block: block, parent: parent)
          order.append(block.id)
          children[parent, default: []].append(block.id)
        }
        if isUndrawn(block) {
          collect(block.children)
        } else {
          index(block.children, under: block.id)
        }
      }
    }

    private mutating func collect(_ list: [Block]) {
      for block in list {
        if !everyID.insert(block.id).inserted { repeatsAnID = true }
        collect(block.children)
      }
    }

    /// The lines under a line, at any depth, in page order.
    func descendants(of id: String) -> [String] {
      (children[id] ?? []).flatMap { [$0] + descendants(of: $0) }
    }

    /// Each shared line in page order with what it is under: what a rearrangement changes, and deleting or adding
    /// a line does not. In a side, a line under one the base does not have is under a new line (as when a Return
    /// moves nested lines to the new half); in the base, a line under one the side deleted is under what that line
    /// was under, where the side's deletion left it.
    func arrangement(over shared: Set<String>, isBase: Bool) -> [Placement] {
      order.filter(shared.contains).map { id in
        var parent = lines[id]?.parent
        while let above = parent, !shared.contains(above) {
          guard isBase else { return Placement(line: id, under: .newLine) }
          parent = lines[above]?.parent
        }
        return Placement(line: id, under: parent.map(Placement.Under.line) ?? .top)
      }
    }

    struct Placement: Equatable {
      enum Under: Equatable {
        case top
        case line(String)
        case newLine
      }

      let line: String
      let under: Under
    }
  }

  fileprivate static func isUndrawn(_ block: Block) -> Bool {
    !EditablePage.drawnTypes.contains(block.type)
  }

  /// `isTaskRow` in `src/domain/editor-document.ts`: a `task` node with a string `taskId`.
  fileprivate static func isToDoRow(_ block: Block) -> Bool {
    block.type == "task" && block.props["taskId"]?.stringValue != nil
  }
}

// MARK: - One line, field by field

extension PageMerge {
  /// A line's fields: the keys of its node but `id`, `props` and `children` (`type`, `content`, anything else), in
  /// the node's order, and the keys of its `props`.
  fileprivate struct Fields {
    let node: JSONObject
    let props: JSONObject

    init(_ block: Block) {
      var alone = block
      alone.children = []
      var node = alone.value.objectValue ?? JSONObject()
      for key in ["id", "props", "children"] { node[key] = nil }
      self.node = node
      props = block.props
    }

    /// The same fields with the same values, in whatever order; stamps on links ignored when `unstamping`.
    func isSame(as other: Fields, unstamping: Bool) -> Bool {
      Self.same(node, other.node, unstamping: unstamping) && Self.same(props, other.props, unstamping: false)
    }

    private static func same(_ a: JSONObject, _ b: JSONObject, unstamping: Bool) -> Bool {
      guard Set(a.keys) == Set(b.keys) else { return false }
      return a.keys.allSatisfy { key in
        key == "content" && unstamping ? unstamped(a[key]) == unstamped(b[key]) : a[key] == b[key]
      }
    }
  }

  fileprivate enum FieldMerge {
    case value(JSONValue?)
    case conflict
  }

  fileprivate enum LineMerge {
    case one(Block)
    case conflict
  }

  /// Whether a side changed a line since the base: some field differs, a stamp on a link not counting.
  fileprivate static func isChanged(_ base: Block, to side: Block) -> Bool {
    !Fields(base).isSame(as: Fields(side), unstamping: true)
  }

  /// A line both sides have. `base` is nil when the base does not have it (an unreadable base).
  fileprivate static func mergeLine(base: Block?, mine: Block, theirs: Block) -> LineMerge {
    let his = Fields(mine)
    let servers = Fields(theirs)
    let before = base.map(Fields.init)
    if let before {
      if before.isSame(as: his, unstamping: false) { return .one(theirs) }
      if before.isSame(as: servers, unstamping: false) { return .one(mine) }
    }
    if his.isSame(as: servers, unstamping: false) { return .one(theirs) }

    func merged(_ his: JSONObject, _ servers: JSONObject, _ before: JSONObject?, words: Bool) -> JSONObject? {
      var out = JSONObject()
      for key in servers.keys + his.keys.filter({ servers[$0] == nil }) {
        let field =
          words && key == "content"
          ? mergeContent(base: before?[key], baseKnown: before != nil, mine: his[key], theirs: servers[key])
          : mergeField(base: before?[key], baseKnown: before != nil, mine: his[key], theirs: servers[key])
        guard case .value(let value) = field else { return nil }
        if let value { out[key] = value }
      }
      return out
    }
    guard
      let node = merged(his.node, servers.node, before?.node, words: true),
      let props = merged(his.props, servers.props, before?.props, words: false)
    else { return .conflict }

    // Built on the server's node, so its key order and anything not merged stay as the server wrote them.
    var line = theirs.value.objectValue ?? JSONObject()
    for key in servers.node.keys where node[key] == nil { line[key] = nil }
    for key in node.keys {
      if line[key] != nil {
        line[key] = node[key]
      } else if let value = node[key] {
        line.set(key, to: value, before: "children")
      }
    }
    if props != servers.props {
      if line["props"] != nil {
        line["props"] = .object(props)
      } else {
        line.set("props", to: .object(props), before: line["content"] != nil ? "content" : "children")
      }
    }
    guard let block = Block(.object(line)) else { return .conflict }
    return .one(block)
  }

  fileprivate static func mergeField(
    base: JSONValue?, baseKnown: Bool, mine: JSONValue?, theirs: JSONValue?
  ) -> FieldMerge {
    if mine == theirs { return .value(theirs) }
    guard baseKnown else { return .conflict }
    if mine == base { return .value(theirs) }
    if theirs == base { return .value(mine) }
    return .conflict
  }

  /// `content`, where the server's stamps on links are not a change of words.
  fileprivate static func mergeContent(
    base: JSONValue?, baseKnown: Bool, mine: JSONValue?, theirs: JSONValue?
  ) -> FieldMerge {
    if mine == theirs { return .value(theirs) }
    let hisWords = unstamped(mine)
    let serversWords = unstamped(theirs)
    guard baseKnown else { return hisWords == serversWords ? .value(theirs) : .conflict }
    if mine == base { return .value(theirs) }
    if theirs == base { return .value(mine) }
    if serversWords == unstamped(base) { return .value(restamped(mine, from: theirs)) }
    if hisWords == serversWords { return .value(theirs) }
    return .conflict
  }

  /// Words with the `at` of each `pageRef` taken out.
  fileprivate static func unstamped(_ content: JSONValue?) -> JSONValue? {
    guard case .array(let items)? = content else { return content }
    return .array(items.map(unstampedItem))
  }

  private static func unstampedItem(_ item: JSONValue) -> JSONValue {
    guard
      var object = item.objectValue, object["type"]?.stringValue == "pageRef",
      var props = object["props"]?.objectValue, props["at"] != nil
    else { return item }
    props["at"] = nil
    object["props"] = .object(props)
    return .object(object)
  }

  /// His words, each `pageRef` of his without `at` replaced by the server's stamped one that is otherwise the same.
  private static func restamped(_ mine: JSONValue?, from theirs: JSONValue?) -> JSONValue? {
    guard case .array(let items)? = mine, case .array(let servers)? = theirs else { return mine }
    let stamped = servers.filter { unstampedItem($0) != $0 }
    var taken = Set<Int>()
    return .array(
      items.map { item in
        guard unstampedItem(item) == item, item.objectValue?["type"]?.stringValue == "pageRef",
          let index = stamped.indices.first(where: { !taken.contains($0) && unstampedItem(stamped[$0]) == item })
        else { return item }
        taken.insert(index)
        return stamped[index]
      })
  }
}

// MARK: - The merge

extension PageMerge {
  /// A line of the merged page while it is put together; written to a `Block` at the end.
  fileprivate final class Node {
    var block: Block
    /// A block the app does not draw: written exactly as the server has it, nested blocks included.
    let isServersWhole: Bool
    /// The server's line (by id), which keeps a `taskId` another row also carries.
    let isServers: Bool
    var children: [Node] = []
    weak var parent: Node?
    /// His words, right below this line, when both changed it differently.
    var copy: Node?

    init(_ block: Block, isServersWhole: Bool = false, isServers: Bool = false) {
      self.block = block
      self.isServersWhole = isServersWhole
      self.isServers = isServers
    }

    func insert(_ node: Node, at index: Int) {
      node.parent = self
      children.insert(node, at: index)
    }

    var written: Block {
      if isServersWhole { return block }
      var out = block
      out.children = children.map(\.written)
      return out
    }
  }

  fileprivate enum Fate {
    case gone
    /// `block` is the line to write (its nested lines come from the merge); `copy`, his line to put below it.
    case kept(Block, isServersWhole: Bool, copy: Block?)
  }

  fileprivate struct Merger {
    let base: Version
    let mine: Version
    let theirs: Version
    let makeID: () -> String

    private var fates: [String: Fate] = [:]
    private var taken: Set<String>
    private let root = Node(Block(id: "", type: ""))
    /// The merged line of each line id of the three versions.
    private var placed: [String: Node] = [:]
    private var walked: Set<String> = []
    private var bothChanged = false

    init(base: Version, mine: Version, theirs: Version, makeID: @escaping () -> String) {
      self.base = base
      self.mine = mine
      self.theirs = theirs
      self.makeID = makeID
      taken = base.everyID.union(mine.everyID).union(theirs.everyID)
    }

    mutating func run() -> (blocks: [Block], bothChanged: Bool) {
      let hisArrangementLeads = hasRearranged(mine) && !hasRearranged(theirs)
      let (lead, other) = hisArrangementLeads ? (mine, theirs) : (theirs, mine)
      walk(lead.blocks, into: root)
      // What the leading arrangement does not hold goes in by the other side's. Then what is left of his leading
      // draft: lines nested under one of his that the server's page has as a block the app does not draw.
      for (version, id) in other.order.map({ (other, $0) }) + lead.order.map({ (lead, $0) }) where placed[id] == nil {
        insert(id, from: version)
      }
      keepEachTaskIDOnOneRow()
      makeIDsUnique()
      return (root.children.map(\.written), bothChanged)
    }

    private func hasRearranged(_ side: Version) -> Bool {
      let shared = Set(base.order).intersection(side.order)
      return side.arrangement(over: shared, isBase: false) != base.arrangement(over: shared, isBase: true)
    }

    // MARK: What each line becomes

    private mutating func fate(of id: String) -> Fate {
      if let known = fates[id] { return known }
      let decided = decide(id)
      fates[id] = decided
      return decided
    }

    private mutating func decide(_ id: String) -> Fate {
      let before = base.lines[id]
      // A line under a block his draft does not draw was not looked at, so he did not change or delete it.
      let his = mine.lines[id] ?? (mine.everyID.contains(id) ? before : nil)
      let server = theirs.lines[id]
      if let server, isUndrawn(server.block) { return .kept(server.block, isServersWhole: true, copy: nil) }
      switch (his, server) {
      case (let his?, let server?):
        if isUndrawn(his.block) { return .kept(server.block, isServersWhole: false, copy: nil) }
        switch mergeLine(base: before?.block, mine: his.block, theirs: server.block) {
        case .one(let line): return .kept(line, isServersWhole: false, copy: nil)
        case .conflict: return .kept(server.block, isServersWhole: false, copy: copyBelow(his.block))
        }
      case (nil, let server?):
        if let before, !isChanged(before.block, to: server.block) { return .gone }
        return .kept(server.block, isServersWhole: false, copy: nil)
      case (let his?, nil):
        if isUndrawn(his.block) { return .gone }
        guard let before else { return .kept(his.block, isServersWhole: false, copy: nil) }
        if !isChanged(before.block, to: his.block) { return .gone }
        // The server no longer has that id, so his line comes back with it, unless it is a to-do's row: a to-do
        // removed elsewhere does not come back because he was typing in it.
        let back = isToDoRow(his.block) ? plainLine(his.block) : his.block
        return .kept(back, isServersWhole: false, copy: nil)
      case (nil, nil):
        return .gone
      }
    }

    /// His line as a new line below the server's: the same kind and props with a fresh id, or a plain line for a
    /// to-do's row, so no second row carries its `taskId`.
    private mutating func copyBelow(_ his: Block) -> Block {
      if isToDoRow(his) { return plainLine(his) }
      var copy = his
      copy.id = freshID()
      copy.children = []
      return copy
    }

    private mutating func plainLine(_ his: Block) -> Block {
      NewBlock.make(.paragraph, id: freshID(), content: his.content, pageDate: nil)
    }

    private mutating func freshID() -> String {
      // `makeID` makes UUIDs; the bound only keeps a function that repeats itself from looping forever.
      for _ in 0..<64 {
        let id = makeID()
        if taken.insert(id).inserted { return id }
      }
      while true {
        let id = NewBlock.id()
        if taken.insert(id).inserted { return id }
      }
    }

    // MARK: Putting the page together

    /// The leading side's lines in its arrangement. A line that goes leaves its nested lines in its place.
    private mutating func walk(_ list: [Block], into parent: Node) {
      for block in list {
        guard walked.insert(block.id).inserted else {
          // The same id again in one version: kept where it is, and given a fresh id at the end.
          let node = Node(block, isServersWhole: isUndrawn(block))
          parent.insert(node, at: parent.children.endIndex)
          if !node.isServersWhole { walk(block.children, into: node) }
          continue
        }
        switch fate(of: block.id) {
        case .gone:
          if !isUndrawn(block) { walk(block.children, into: parent) }
        case .kept(let line, let isServersWhole, let copy):
          let node = place(block.id, line, isServersWhole, copy, in: parent, at: parent.children.endIndex)
          // Under a block this version does not draw nothing was read; the server's lines there go in after.
          if !isServersWhole, !isUndrawn(block) { walk(block.children, into: node) }
        }
      }
    }

    private mutating func insert(_ id: String, from version: Version) {
      guard case .kept(let line, let isServersWhole, let copy) = fate(of: id) else { return }
      let (parent, index) = position(of: id, in: version)
      place(id, line, isServersWhole, copy, in: parent, at: index)
    }

    @discardableResult
    private mutating func place(
      _ id: String, _ line: Block, _ isServersWhole: Bool, _ copy: Block?, in parent: Node, at index: Int
    ) -> Node {
      let node = Node(line, isServersWhole: isServersWhole, isServers: theirs.lines[id] != nil)
      parent.insert(node, at: index)
      placed[id] = node
      if let copy {
        let below = Node(copy)
        parent.insert(below, at: index + 1)
        node.copy = below
        bothChanged = true
      }
      return node
    }

    /// Where a line of `version` goes in the merged page: after the nearest line before it at its level that is
    /// there (or that line's last nested line that is), else first under its parent, else where its parent goes.
    private func position(of id: String, in version: Version) -> (Node, Int) {
      let parent = version.lines[id]?.parent
      let siblings = version.children[parent] ?? []
      let index = siblings.firstIndex(of: id) ?? 0
      for earlier in siblings[..<index].reversed() {
        for candidate in [earlier] + version.descendants(of: earlier).reversed() {
          if let node = placed[candidate], let after = Self.after(node) { return after }
        }
      }
      guard let parent else { return (root, 0) }
      if let node = placed[parent], !node.isServersWhole { return (node, 0) }
      return position(of: parent, in: version)
    }

    /// Right after a line and his words below it.
    private static func after(_ node: Node) -> (Node, Int)? {
      let last = node.copy ?? node
      guard let parent = last.parent, let index = parent.children.firstIndex(where: { $0 === last }) else { return nil }
      return (parent, index + 1)
    }

    /// A `taskId` on two rows stays on the server's (the first of the server's, else the first in page order); each
    /// other row carrying it becomes a plain line with its words, as one to-do must not become two.
    private func keepEachTaskIDOnOneRow() {
      var rows: [(node: Node?, taskId: String, isServers: Bool)] = []
      func collectWhole(_ block: Block) {
        if isToDoRow(block), let taskId = block.props["taskId"]?.stringValue { rows.append((nil, taskId, true)) }
        block.children.forEach(collectWhole)
      }
      func collect(_ node: Node) {
        if node.isServersWhole { return collectWhole(node.block) }
        if isToDoRow(node.block), let taskId = node.block.props["taskId"]?.stringValue {
          rows.append((node, taskId, node.isServers))
        }
        node.children.forEach(collect)
      }
      root.children.forEach(collect)

      var keeper: [String: Int] = [:]
      for (index, row) in rows.enumerated() {
        if let kept = keeper[row.taskId], rows[kept].isServers || !row.isServers { continue }
        keeper[row.taskId] = index
      }
      for (index, row) in rows.enumerated() where keeper[row.taskId] != index {
        guard let node = row.node else { continue }
        node.block = NewBlock.make(.paragraph, id: node.block.id, content: node.block.content, pageDate: nil)
      }
    }

    /// A repeated id gets a fresh one; ids inside a block the app does not draw are the server's and never change.
    private mutating func makeIDsUnique() {
      var reserved = Set<String>()
      func reserve(_ block: Block) {
        reserved.insert(block.id)
        block.children.forEach(reserve)
      }
      func collect(_ node: Node) {
        if node.isServersWhole { reserve(node.block) } else { node.children.forEach(collect) }
      }
      root.children.forEach(collect)

      var seen = Set<String>()
      var nodes = root.children
      while !nodes.isEmpty {
        let node = nodes.removeFirst()
        if node.isServersWhole { continue }
        if reserved.contains(node.block.id) || !seen.insert(node.block.id).inserted {
          node.block.id = freshID()
          seen.insert(node.block.id)
        }
        nodes.insert(contentsOf: node.children, at: 0)
      }
    }
  }
}
