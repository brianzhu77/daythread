/// The three-way merge of a page (spec §10.6), run without asking him when the server's page changed while he typed.
///
/// Neither side replaces the other, and he is not asked. Three versions are known: the page the draft started from
/// (`base`), his draft (`mine`), and the page as the server now has it (`theirs`). They are merged line by line, by
/// line id, at any depth. A line is changed when its written node, without `children`, differs from the base's.
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
/// - A line he puts back or adds goes after the nearest earlier line before it at its own level that is still
///   there (its last surviving nested line, when the line itself is gone); with none, first under its parent; and
///   under a parent that is gone, where that parent would go. His line below the server's sits right after the
///   server's line and what is nested under it, at its depth, with a fresh id and no nested lines.
/// - A block the app does not draw (a database, a synced block, anything `EditablePage` does not edit) is always the
///   server's, with everything under it as the server has it; when the server no longer has it, it is gone.
/// - A side "rearranged" when the lines it shares with the base are in another order, or under another of those
///   lines, than in the base. Deleting a line, whose nested lines take its place, is not a rearrangement.
/// - A page that does not parse is never read as an empty page: an unreadable server page leaves his draft, an
///   unreadable draft leaves the server's page, and an unreadable base is merged as if nothing were known of it, so
///   every line of either side is kept.
/// - No block id appears twice in the result: a repeated id is given a fresh one, never one of a block the app does
///   not draw.
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
    let server = Version(theirsBlocks)
    let draft = Version(mineBlocks)
    if theirs.hasSameCodeUnits(as: base), !draft.repeatsAnID { return Merged(document: mine, bothChanged: false) }
    if mine.hasSameCodeUnits(as: base) || mine.hasSameCodeUnits(as: theirs), !server.repeatsAnID {
      return Merged(document: theirs, bothChanged: false)
    }

    let merged = withoutActuallyEscaping(makeID) { makeID in
      var merger = Merger(base: Version(Version.read(base) ?? []), mine: draft, theirs: server, makeID: makeID)
      return merger.run()
    }
    let document = Document.write(merged.blocks)
    // A merge that comes to one side's page gives that page as it was stored, not rewritten.
    if document.hasSameCodeUnits(as: Document.write(theirsBlocks)) {
      return Merged(document: theirs, bothChanged: false)
    }
    if document.hasSameCodeUnits(as: Document.write(mineBlocks)) { return Merged(document: mine, bothChanged: false) }
    return Merged(document: document, bothChanged: merged.bothChanged)
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
      /// The node as written without its nested lines: what "changed" compares.
      let form: String
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
          lines[block.id] = Line(block: block, parent: parent, form: Self.form(of: block))
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

    private static func form(of block: Block) -> String {
      var alone = block
      alone.children = []
      return JSON.write(alone.value)
    }

    /// The lines under a line, at any depth, in page order.
    func descendants(of id: String) -> [String] {
      (children[id] ?? []).flatMap { [$0] + descendants(of: $0) }
    }

    /// Each shared line in page order with the nearest line above it that is also shared: what a rearrangement
    /// changes, and deleting or adding a line does not.
    func arrangement(over shared: Set<String>) -> [Placement] {
      order.filter(shared.contains).map { id in
        var parent = lines[id]?.parent
        while let above = parent, !shared.contains(above) { parent = lines[above]?.parent }
        return Placement(line: id, under: parent)
      }
    }

    struct Placement: Equatable {
      let line: String
      let under: String?
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

// MARK: - The merge

extension PageMerge {
  /// A line of the merged page while it is put together; written to a `Block` at the end.
  fileprivate final class Node {
    var block: Block
    /// A block the app does not draw: written exactly as the server has it, nested blocks included.
    let isServersWhole: Bool
    var children: [Node] = []
    weak var parent: Node?
    /// His words, right below this line, when both changed it differently.
    var copy: Node?

    init(_ block: Block, isServersWhole: Bool = false) {
      self.block = block
      self.isServersWhole = isServersWhole
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
      walk(lead.blocks, of: lead, into: root)
      // What the leading arrangement does not hold goes in by the other side's; then anything left of the leading
      // side, whose place was inside a block the server's version does not draw.
      for (version, id) in other.order.map({ (other, $0) }) + lead.order.map({ (lead, $0) }) where placed[id] == nil {
        insert(id, from: version)
      }
      makeIDsUnique()
      return (root.children.map(\.written), bothChanged)
    }

    private func hasRearranged(_ side: Version) -> Bool {
      let shared = Set(base.order).intersection(side.order)
      return side.arrangement(over: shared) != base.arrangement(over: shared)
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
      let his = mine.lines[id]
      let server = theirs.lines[id]
      if let server, isUndrawn(server.block) || his.map({ isUndrawn($0.block) }) == true {
        return .kept(server.block, isServersWhole: true, copy: nil)
      }
      switch (his, server) {
      case (let his?, let server?):
        if his.form.hasSameCodeUnits(as: server.form) { return .kept(server.block, isServersWhole: false, copy: nil) }
        // With no base line (an unreadable base), each side's line counts as written by that side.
        let heChanged = before.map { !$0.form.hasSameCodeUnits(as: his.form) } ?? true
        let serverChanged = before.map { !$0.form.hasSameCodeUnits(as: server.form) } ?? true
        if heChanged && !serverChanged { return .kept(his.block, isServersWhole: false, copy: nil) }
        if serverChanged && !heChanged { return .kept(server.block, isServersWhole: false, copy: nil) }
        return .kept(server.block, isServersWhole: false, copy: copyBelow(his.block))
      case (nil, let server?):
        if let before, before.form.hasSameCodeUnits(as: server.form) { return .gone }
        return .kept(server.block, isServersWhole: false, copy: nil)
      case (let his?, nil):
        if isUndrawn(his.block) { return .gone }
        guard let before else { return .kept(his.block, isServersWhole: false, copy: nil) }
        if before.form.hasSameCodeUnits(as: his.form) { return .gone }
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
    private mutating func walk(_ list: [Block], of version: Version, into parent: Node) {
      for block in list {
        guard walked.insert(block.id).inserted else {
          // The same id again in one version: kept where it is, and given a fresh id at the end.
          let node = Node(block, isServersWhole: isUndrawn(block))
          parent.insert(node, at: parent.children.endIndex)
          if !node.isServersWhole { walk(block.children, of: version, into: node) }
          continue
        }
        switch fate(of: block.id) {
        case .gone:
          if !isUndrawn(block) { walk(block.children, of: version, into: parent) }
        case .kept(let line, let isServersWhole, let copy):
          let node = place(block.id, line, isServersWhole, copy, in: parent, at: parent.children.endIndex)
          if !isServersWhole { walk(block.children, of: version, into: node) }
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
      let node = Node(line, isServersWhole: isServersWhole)
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
