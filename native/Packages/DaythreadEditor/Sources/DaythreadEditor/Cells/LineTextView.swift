#if canImport(UIKit)
  import DaythreadCore
  import UIKit

  /// What the screen is told about a line beyond what `UITextViewDelegate` says.
  @MainActor
  protocol LineTextViewDelegate: UITextViewDelegate {
    /// A key that changes the page's structure: Return, Backspace at the start of the line, Tab or Shift-Tab, never
    /// while text is marked. True when the screen took it; a Backspace it did not take deletes as usual.
    func lineTextView(_ line: LineTextView, didPress key: EditablePage.Key) -> Bool
    /// Marked text was set or committed, which a text view does not always report as a change of its text.
    func lineTextViewMarkedTextDidChange(_ line: LineTextView)
    /// The line has given the keyboard up: its resign is over.
    func lineTextViewDidGiveUpKeyboard(_ line: LineTextView)
    /// The line's resign was refused: it keeps the keyboard, though its resign may have ended a composition.
    func lineTextViewKeptKeyboard(_ line: LineTextView)
    /// Whether some row in that direction takes a caret.
    func lineTextView(_ line: LineTextView, canMoveCaret direction: LineTextView.Direction) -> Bool
    /// The caret goes to the next row in that direction that takes one, as near to `point` (in the line's
    /// coordinates) across the row as its words allow.
    func lineTextView(_ line: LineTextView, moveCaret direction: LineTextView.Direction, near point: CGPoint)
  }

  /// A row's words: a text view on TextKit 2 that does not scroll and adds no inset of its own, so the row's margins
  /// are the only space around the words.
  final class LineTextView: UITextView {
    /// The row whose words these are. Set on every configure, so a reused cell never speaks for an old row.
    var rowID: String?
    /// The words as read aloud: the line's text, with each token's words where its attachment is.
    var words = ""
    /// The line's text as the page last had it when the two were the same: when the line was drawn, and after each
    /// read. A change on screen is read against it, and only into a page line that still holds it.
    var syncedText = ""
    /// The traits a heading adds to the text view's own.
    var addedTraits: UIAccessibilityTraits = []

    private var lineDelegate: LineTextViewDelegate? { delegate as? LineTextViewDelegate }

    init() {
      super.init(frame: .zero, textContainer: nil)
      isScrollEnabled = false
      textContainerInset = .zero
      textContainer.lineFragmentPadding = 0
      // Lines spaced as a label spaces them: the row's label lays the words out (`LineBlockCell`), and with the font's
      // leading TextKit 2 puts more space between lines than the label does, so the words would outgrow the row.
      textLayoutManager?.usesFontLeading = false
      backgroundColor = .clear
      // Styles come from the line's runs; pasting brings in words, never their look.
      allowsEditingTextAttributes = false
      // Three hyphens typed in a row are the divider shortcut; turned into a dash as they are typed, the line would
      // never read "---". Autocorrection, spelling, smart quotes and dictation stay the system's.
      smartDashesType = .no
      isAccessibilityElement = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var accessibilityValue: String? {
      get { words }
      set {}
    }

    /// The text view's own traits, which say whether it is edited, with a heading's added.
    override var accessibilityTraits: UIAccessibilityTraits {
      get { super.accessibilityTraits.union(addedTraits) }
      set { super.accessibilityTraits = newValue }
    }

    /// Sets what the line shows, keeping the caret and the selection where they were in the words, clamped to them.
    func show(_ text: NSAttributedString) {
      let selection = selectedRange
      attributedText = text
      syncedText = text.string
      guard isFirstResponder else { return }
      let length = (self.text as NSString).length
      let location = min(selection.location, length)
      selectedRange = NSRange(location: location, length: min(selection.length, length - location))
    }

    // MARK: words that come in

    /// What stands in the text for a token's attachment. It is never a character of the line.
    static let objectReplacement = Unicode.Scalar(0xFFFC)!

    /// Return, as a keyboard may spell it.
    static func isReturn(_ text: String) -> Bool { text == "\n" || text == "\r" || text == "\r\n" }

    // Checked scalar by scalar: a tab or an object replacement followed by a combining mark is one Character, which
    // equals neither.

    /// Whether words that come in hold something a line never holds: a line break, a tab, an object replacement.
    static func needsCleaning(_ text: String) -> Bool {
      text.unicodeScalars.contains { isBreak($0) || $0 == objectReplacement }
    }

    static func holdsObjectReplacement(_ text: String) -> Bool {
      text.unicodeScalars.contains(objectReplacement)
    }

    /// The words as one line: each line break (CR LF as one) and tab a space, and no object replacement character.
    static func cleaned(_ text: String) -> String {
      var words = String.UnicodeScalarView()
      var previous: Unicode.Scalar?
      for scalar in text.unicodeScalars {
        defer { previous = scalar }
        if scalar == objectReplacement || (scalar == "\n" && previous == "\r") { continue }
        words.append(isBreak(scalar) ? " " : scalar)
      }
      return String(words)
    }

    private static func isBreak(_ scalar: Unicode.Scalar) -> Bool {
      scalar == "\t" || CharacterSet.newlines.contains(scalar)
    }

    /// Replaces `range` with `words` on the run loop's next turn, as typing would: a text view ignores a change made
    /// while it asks its delegate about another. Dropped if the line is given to another row, its text changes, or it
    /// stops being editable before then: the range belongs to the text as it is now. In the common modes, so it does
    /// not wait for a scroll of the list to end.
    func replaceSoon(_ range: NSRange, with words: String) {
      cancelPendingReplacement()
      pendingReplacement = (range, words, rowID, text)
      perform(#selector(replacePending), with: nil, afterDelay: 0, inModes: [.common])
    }

    func cancelPendingReplacement() {
      pendingReplacement = nil
      NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(replacePending), object: nil)
    }

    private var pendingReplacement: (range: NSRange, words: String, rowID: String?, text: String)?

    /// What is waiting for the run loop's next turn goes in now: a key that comes first acts after the words.
    func applyPendingReplacement() {
      guard pendingReplacement != nil else { return }
      NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(replacePending), object: nil)
      replacePending()
    }

    @objc private func replacePending() {
      guard let pending = pendingReplacement else { return }
      pendingReplacement = nil
      guard
        isEditable, pending.rowID == rowID, pending.text == text,
        let start = position(from: beginningOfDocument, offset: pending.range.location),
        let end = position(from: start, offset: pending.range.length),
        let replaced = textRange(from: start, to: end)
      else { return }
      replace(replaced, withText: pending.words)
      // The caret goes after the words, as it does after typing them.
      selectedRange = NSRange(location: pending.range.location + (pending.words as NSString).length, length: 0)
    }

    /// Return is a key of the page's, not a character of the line; while text is marked it only commits it. A tab is
    /// the Tab key (an iPad's software keyboard sends it as a character). Other line breaks and tabs become spaces,
    /// and an object replacement character is dropped. (A keyboard asks the delegate first; this holds for every
    /// other caller too.)
    override func insertText(_ text: String) {
      if Self.isReturn(text) {
        if markedTextRange != nil {
          unmarkText()
        } else {
          _ = lineDelegate?.lineTextView(self, didPress: .returnKey)
        }
        return
      }
      if text == "\t" {
        if markedTextRange == nil { _ = lineDelegate?.lineTextView(self, didPress: .tab) }
        return
      }
      guard Self.needsCleaning(text) else {
        super.insertText(text)
        return
      }
      let words = Self.cleaned(text)
      if !words.isEmpty { super.insertText(words) }
    }

    override func replace(_ range: UITextRange, withText text: String) {
      super.replace(range, withText: Self.needsCleaning(text) ? Self.cleaned(text) : text)
    }

    /// Pasted words go in as one line, without object replacement characters.
    override func paste(_ sender: Any?) {
      guard let words = UIPasteboard.general.string, Self.needsCleaning(words) else {
        super.paste(sender)
        return
      }
      let cleaned = Self.cleaned(words)
      if !cleaned.isEmpty { insertText(cleaned) }
    }

    /// A chip goes to the pasteboard as its words: its attachment's character is not words.
    override func copy(_ sender: Any?) {
      guard selectedRange.length > 0, holdsToken(in: selectedRange) else {
        super.copy(sender)
        return
      }
      UIPasteboard.general.string = pasteboardWords(in: selectedRange)
    }

    override func cut(_ sender: Any?) {
      guard isEditable, selectedRange.length > 0, holdsToken(in: selectedRange), let range = selectedTextRange else {
        super.cut(sender)
        return
      }
      UIPasteboard.general.string = pasteboardWords(in: selectedRange)
      replace(range, withText: "")
    }

    /// The words in `range` as they read: each token's words where its attachment is. Each attachment character is
    /// one token, so two the same side by side are two; a character that is not an attachment is itself.
    func pasteboardWords(in range: NSRange) -> String {
      let text = attributedText.attributedSubstring(from: range)
      var out = ""
      text.enumerateAttributes(in: NSRange(location: 0, length: text.length)) { attributes, part, _ in
        if attributes[.attachment] != nil, let words = attributes[InlineTextStorage.tokenWords] as? String {
          out += String(repeating: words, count: part.length)
        } else {
          out += text.attributedSubstring(from: part).string
        }
      }
      return out
    }

    private func holdsToken(in range: NSRange) -> Bool {
      var found = false
      attributedText.enumerateAttribute(.attachment, in: range) { value, _, stop in
        if value != nil {
          found = true
          stop.pointee = true
        }
      }
      return found
    }

    // MARK: marked text and keys

    override func setMarkedText(_ markedText: String?, selectedRange: NSRange) {
      super.setMarkedText(markedText, selectedRange: selectedRange)
      lineDelegate?.lineTextViewMarkedTextDidChange(self)
    }

    override func unmarkText() {
      super.unmarkText()
      lineDelegate?.lineTextViewMarkedTextDidChange(self)
    }

    /// A composition ends with the keyboard. The system commits it without calling `unmarkText` or reporting a change
    /// of the text (seen on the simulator), so the line would stay composing; it is committed here, and read.
    @discardableResult
    override func resignFirstResponder() -> Bool {
      isGivingUpKeyboard = true
      if markedTextRange != nil { unmarkText() }
      let resigned = super.resignFirstResponder()
      isGivingUpKeyboard = false
      if resigned {
        lineDelegate?.lineTextViewDidGiveUpKeyboard(self)
      } else {
        lineDelegate?.lineTextViewKeptKeyboard(self)
      }
      return resigned
    }

    /// True while the line's resign is under way: what it commits then must not take the keyboard back.
    private(set) var isGivingUpKeyboard = false

    /// True while its cell gives the line to another row, or to none (`LineBlockCell.releaseLine`): the list is
    /// dequeuing or configuring the cell, and must not be given a snapshot from inside that.
    var isBeingReleased = false

    override func deleteBackward() {
      let atStart = markedTextRange == nil && selectedRange == NSRange(location: 0, length: 0)
      if atStart, lineDelegate?.lineTextView(self, didPress: .backspace) == true { return }
      super.deleteBackward()
    }

    override var keyCommands: [UIKeyCommand]? {
      let tab = UIKeyCommand(input: "\t", modifierFlags: [], action: #selector(pressTab))
      let shiftTab = UIKeyCommand(input: "\t", modifierFlags: .shift, action: #selector(pressShiftTab))
      let up = UIKeyCommand(input: UIKeyCommand.inputUpArrow, modifierFlags: [], action: #selector(caretToRowAbove))
      let down = UIKeyCommand(input: UIKeyCommand.inputDownArrow, modifierFlags: [], action: #selector(caretToRowBelow))
      // Without priority the text view would type a tab character into the line, and move the caret itself on the
      // arrows. The arrows are taken only on the line's edge (`canPerformAction`); elsewhere they are the system's.
      for command in [tab, shiftTab, up, down] { command.wantsPriorityOverSystemBehavior = true }
      return (super.keyCommands ?? []) + [tab, shiftTab, up, down]
    }

    /// Up or down out of a row.
    enum Direction { case up, down }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
      switch action {
      case #selector(caretToRowAbove): leavesRow(.up)
      case #selector(caretToRowBelow): leavesRow(.down)
      default: super.canPerformAction(action, withSender: sender)
      }
    }

    /// Whether an arrow key takes the caret out of the row: the caret, with nothing selected or marked, is on the
    /// row's first visual line (up) or last (down), and some row that way takes a caret.
    private func leavesRow(_ direction: Direction) -> Bool {
      guard markedTextRange == nil, let caret = selectedTextRange, caret.isEmpty else { return false }
      let edge = caretRect(for: direction == .up ? beginningOfDocument : endOfDocument)
      let here = caretRect(for: caret.start)
      guard abs(here.midY - edge.midY) < max(1, edge.height / 2) else { return false }
      return lineDelegate?.lineTextView(self, canMoveCaret: direction) ?? false
    }

    @objc private func caretToRowAbove() { moveCaret(.up) }

    @objc private func caretToRowBelow() { moveCaret(.down) }

    private func moveCaret(_ direction: Direction) {
      guard leavesRow(direction), let caret = selectedTextRange else { return }
      let here = caretRect(for: caret.start)
      lineDelegate?.lineTextView(self, moveCaret: direction, near: CGPoint(x: here.midX, y: here.midY))
    }

    @objc private func pressTab() {
      guard markedTextRange == nil else { return }
      _ = lineDelegate?.lineTextView(self, didPress: .tab)
    }

    @objc private func pressShiftTab() {
      guard markedTextRange == nil else { return }
      _ = lineDelegate?.lineTextView(self, didPress: .shiftTab)
    }
  }
#endif
