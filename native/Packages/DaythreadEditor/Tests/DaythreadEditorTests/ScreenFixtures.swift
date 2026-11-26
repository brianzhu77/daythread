#if canImport(UIKit)
  import DaythreadCore
  import Testing
  import UIKit

  @testable import DaythreadEditor

  /// A page being edited, in a window, as he sees it.
  @MainActor
  struct Screen {
    let window: UIWindow
    let controller: DocumentViewController

    /// A page of `blocks` shown for editing in a window of its own.
    static func editing(
      _ blocks: [Block], tasks: [JSONValue] = [], width: CGFloat = 390, safeArea: CGFloat = 0,
      category: UIContentSizeCategory = .large
    ) throws -> Screen {
      let controller = DocumentViewController()
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 844))
      window.traitOverrides.preferredContentSizeCategory = category
      window.rootViewController = controller
      window.makeKeyAndVisible()
      controller.additionalSafeAreaInsets = UIEdgeInsets(top: 0, left: safeArea, bottom: 0, right: safeArea)
      controller.view.layoutIfNeeded()
      controller.edit(page: try makePage(blocks), in: try makeWorkspace(tasks: tasks))
      return Screen(window: window, controller: controller)
    }

    var list: UICollectionView {
      let list = controller.view as! UICollectionView
      list.layoutIfNeeded()
      return list
    }

    func cell(_ item: Int) throws -> UICollectionViewCell {
      try #require(list.cellForItem(at: IndexPath(item: item, section: 0)))
    }

    /// The text view that holds a row's words.
    func line(_ item: Int) throws -> LineTextView {
      try #require((try cell(item) as? LineBlockCell)?.line, "row \(item) has no text view")
    }

    /// Puts the caret in a row's line at `offset` (its end when nil).
    @discardableResult
    func focus(_ item: Int, at offset: Int? = nil) throws -> LineTextView {
      let line = try line(item)
      #expect(line.becomeFirstResponder())
      line.selectedRange = NSRange(location: offset ?? (line.text as NSString).length, length: 0)
      return line
    }

    /// The page's blocks as the screen has them now.
    func blocks() throws -> [Block] {
      Document.blocks(try #require(controller.document))
    }

    /// Each top-level block's words, in order.
    func words() throws -> [String] {
      try blocks().map { InlineContent($0.content).plain }
    }

    /// Lets the run loop turn until `condition` holds, for what the system does after a turn (the keyboard, an
    /// animated scroll). Synchronous, so no other test runs on the main actor meanwhile.
    func wait(_ seconds: TimeInterval = 5, until condition: () -> Bool) -> Bool {
      let end = Date().addingTimeInterval(seconds)
      while !condition(), Date() < end { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
      return condition()
    }

    /// The hardware key command a line answers to for `input` with `modifiers`.
    func keyCommand(_ line: LineTextView, _ input: String, _ modifiers: UIKeyModifierFlags = []) throws -> UIKeyCommand {
      try #require(
        line.keyCommands?.first { $0.input == input && $0.modifierFlags == modifiers },
        "the line has no key command for \(input)")
    }

    /// Whether the line takes the key itself (true) or leaves it to the system's own behaviour.
    func takesKey(_ line: LineTextView, _ input: String, _ modifiers: UIKeyModifierFlags = []) throws -> Bool {
      let command = try keyCommand(line, input, modifiers)
      return line.canPerformAction(try #require(command.action), withSender: command)
    }

    /// A hardware key, as the system sends it to the line when the line takes it.
    func press(_ line: LineTextView, _ input: String, _ modifiers: UIKeyModifierFlags = []) throws {
      let command = try keyCommand(line, input, modifiers)
      line.perform(command.action, with: command)
    }
  }
#endif
