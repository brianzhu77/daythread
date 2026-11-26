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
  }

  /// A row's words: a text view on TextKit 2 that does not scroll and adds no inset of its own, so the row's margins
  /// are the only space around the words.
  final class LineTextView: UITextView {
    /// The row whose words these are. Set on every configure, so a reused cell never speaks for an old row.
    var rowID: String?
    /// The words as read aloud: the line's text, with each token's words where its attachment is.
    var words = ""
    /// The traits a heading adds to the text view's own.
    var addedTraits: UIAccessibilityTraits = [] {
      didSet { accessibilityTraits = ownTraits.union(addedTraits) }
    }
    private var ownTraits: UIAccessibilityTraits = []

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
      ownTraits = accessibilityTraits
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var accessibilityValue: String? {
      get { words }
      set {}
    }

    /// Sets what the line shows, keeping the caret and the selection where they were in the words, clamped to them.
    func show(_ text: NSAttributedString) {
      let selection = selectedRange
      attributedText = text
      guard isFirstResponder else { return }
      let length = (self.text as NSString).length
      let location = min(selection.location, length)
      selectedRange = NSRange(location: location, length: min(selection.length, length - location))
    }

    // MARK: input

    /// The words with each line break a space: a line never holds a newline it did not have.
    static func oneLine(_ words: String) -> String {
      String(words.map { $0.isNewline ? " " : $0 })
    }

    /// Replaces `range` with `words` on the run loop's next turn, as typing would: a text view ignores a change made
    /// while it asks its delegate about another.
    func replaceSoon(_ range: NSRange, with words: String) {
      pendingReplacement = (range, words)
      perform(#selector(replacePending), with: nil, afterDelay: 0)
    }

    private var pendingReplacement: (range: NSRange, words: String)?

    @objc private func replacePending() {
      guard let (range, words) = pendingReplacement else { return }
      pendingReplacement = nil
      guard
        NSMaxRange(range) <= (text as NSString).length,
        let start = position(from: beginningOfDocument, offset: range.location),
        let end = position(from: start, offset: range.length),
        let replaced = textRange(from: start, to: end)
      else { return }
      replace(replaced, withText: words)
    }

    /// Pasted words go in as one line.
    override func paste(_ sender: Any?) {
      guard let words = UIPasteboard.general.string, words.contains(where: \.isNewline) else {
        super.paste(sender)
        return
      }
      insertText(Self.oneLine(words))
    }

    /// Return is a key of the page's, not a character of the line; while text is marked it only commits it. Other
    /// line breaks become spaces. (A keyboard asks the delegate first; this holds for every other caller too.)
    override func insertText(_ text: String) {
      guard text.contains(where: \.isNewline) else {
        super.insertText(text)
        return
      }
      if text == "\n" {
        if markedTextRange != nil {
          unmarkText()
        } else {
          _ = lineDelegate?.lineTextView(self, didPress: .returnKey)
        }
        return
      }
      super.insertText(Self.oneLine(text))
    }

    override func replace(_ range: UITextRange, withText text: String) {
      super.replace(range, withText: text.contains(where: \.isNewline) ? Self.oneLine(text) : text)
    }

    override func setMarkedText(_ markedText: String?, selectedRange: NSRange) {
      super.setMarkedText(markedText, selectedRange: selectedRange)
      lineDelegate?.lineTextViewMarkedTextDidChange(self)
    }

    override func unmarkText() {
      super.unmarkText()
      lineDelegate?.lineTextViewMarkedTextDidChange(self)
    }

    override func deleteBackward() {
      let atStart = markedTextRange == nil && selectedRange == NSRange(location: 0, length: 0)
      if atStart, lineDelegate?.lineTextView(self, didPress: .backspace) == true { return }
      super.deleteBackward()
    }

    override var keyCommands: [UIKeyCommand]? {
      let tab = UIKeyCommand(input: "\t", modifierFlags: [], action: #selector(pressTab))
      let shiftTab = UIKeyCommand(input: "\t", modifierFlags: .shift, action: #selector(pressShiftTab))
      // Without priority the text view would type a tab character into the line.
      for command in [tab, shiftTab] { command.wantsPriorityOverSystemBehavior = true }
      return (super.keyCommands ?? []) + [tab, shiftTab]
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
