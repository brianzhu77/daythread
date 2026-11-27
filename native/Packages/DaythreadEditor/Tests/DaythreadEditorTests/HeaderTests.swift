#if canImport(UIKit)
  import DaythreadCore
  import Testing
  import UIKit

  @testable import DaythreadEditor

  extension OnScreen {
    /// The page's header, whose height its host changes (the day's facts above the page): the list scrolls to a row
    /// asked for, and the line he types in stays where it is on the screen when the header grows or shrinks (Review
    /// Focus 1).
    @MainActor
    @Suite struct HeaderTests {
      /// A page of sixty lines `l1`…`l60` under a header `height` points tall, and the constraint that sets it.
      private func page(header height: CGFloat) throws -> (screen: Screen, height: NSLayoutConstraint) {
        let blocks = (1...60).map { block("l\($0)", "paragraph", text: "Line \($0)") }
        let screen = try Screen.editing(blocks)
        let header = UIView()
        let constraint = header.heightAnchor.constraint(equalToConstant: height)
        // Below required: the container is sized by the list, which measures the header through it.
        constraint.priority = .required - 1
        constraint.isActive = true
        screen.controller.headerView = header
        _ = screen.list
        return (screen, constraint)
      }

      /// Scrolls the list so row `item` is in the middle of what it shows, and lets the layout settle.
      private func show(_ item: Int, on screen: Screen) throws {
        let list = screen.list
        let row = try #require(list.layoutAttributesForItem(at: IndexPath(item: item, section: 0)))
        list.setContentOffset(CGPoint(x: 0, y: row.frame.midY - list.bounds.height / 2), animated: false)
        _ = screen.list
      }

      /// Puts the caret in row `item` and waits for the keyboard (and the list's scroll to the caret) to settle.
      private func type(in item: Int, on screen: Screen) throws -> LineTextView {
        try show(item, on: screen)
        let line = try screen.focus(item, at: 2)
        _ = screen.wait(1) { false }
        _ = screen.list
        return line
      }

      private func frameInWindow(_ view: UIView) -> CGRect {
        view.convert(view.bounds, to: nil)
      }

      private func bottom(of list: UICollectionView) -> CGFloat {
        max(
          -list.adjustedContentInset.top,
          list.contentSize.height + list.adjustedContentInset.bottom - list.bounds.height)
      }

      @Test func scroll_to_a_row_puts_it_at_the_top() throws {
        let (screen, _) = try page(header: 100)
        #expect(screen.controller.scroll(toRow: "l40", animated: false))
        let list = screen.list
        let row = try screen.cell(39).frame
        #expect(abs(row.minY - (list.contentOffset.y + list.adjustedContentInset.top)) < 0.5)
      }

      @Test func scroll_to_a_row_near_the_end_stops_at_the_end() throws {
        let (screen, _) = try page(header: 100)
        #expect(screen.controller.scroll(toRow: "l60", animated: false))
        let list = screen.list
        #expect(abs(list.contentOffset.y - bottom(of: list)) < 0.5, "the list's bottom, not past it")
        let row = try screen.cell(59).frame
        let shown = list.bounds.inset(by: list.adjustedContentInset)
        #expect(row.minY >= shown.minY - 0.5 && row.maxY <= shown.maxY + 0.5, "the row shows")
      }

      @Test func scroll_to_a_row_that_is_not_there_does_nothing() throws {
        let (screen, _) = try page(header: 100)
        try show(20, on: screen)
        let before = screen.list.contentOffset
        #expect(!screen.controller.scroll(toRow: "nowhere", animated: false))
        #expect(screen.list.contentOffset == before)
      }

      @Test func a_header_that_grows_keeps_the_typed_line_where_it_is() throws {
        let (screen, height) = try page(header: 100)
        let line = try type(in: 29, on: screen)
        let before = frameInWindow(line)
        let selection = line.selectedRange

        height.constant = 300
        screen.controller.headerDidChange()
        _ = screen.list

        #expect(abs(frameInWindow(line).minY - before.minY) < 0.5, "his line stays where it is on the screen")
        #expect(line.isFirstResponder)
        #expect(line.selectedRange == selection)
        #expect(try screen.line(29) === line)
      }

      @Test func a_header_that_shrinks_keeps_the_typed_line_where_it_is() throws {
        let (screen, height) = try page(header: 300)
        let line = try type(in: 29, on: screen)
        let before = frameInWindow(line)
        let selection = line.selectedRange

        height.constant = 100
        screen.controller.headerDidChange()
        _ = screen.list

        #expect(abs(frameInWindow(line).minY - before.minY) < 0.5, "his line stays where it is on the screen")
        #expect(line.isFirstResponder)
        #expect(line.selectedRange == selection)
      }

      /// Nothing is above the top to scroll to: the page stays at its top and his line moves up with the header.
      @Test func a_header_that_shrinks_with_the_page_at_its_top_leaves_it_at_its_top() throws {
        let (screen, height) = try page(header: 300)
        let line = try screen.focus(1, at: 2)
        _ = screen.wait(1) { false }
        let list = screen.list
        let top = -list.adjustedContentInset.top
        #expect(abs(list.contentOffset.y - top) < 0.5)

        height.constant = 100
        screen.controller.headerDidChange()

        #expect(abs(screen.list.contentOffset.y - top) < 0.5, "the page stays at its top")
        #expect(line.isFirstResponder)
      }

      @Test func without_a_line_typed_in_the_rows_move_with_the_header() throws {
        let (screen, height) = try page(header: 100)
        let before = screen.list.contentOffset
        let first = frameInWindow(try screen.cell(0))

        height.constant = 300
        screen.controller.headerDidChange()

        #expect(screen.list.contentOffset == before)
        #expect(abs(frameInWindow(try screen.cell(0)).minY - (first.minY + 200)) < 0.5)
      }

      @Test func a_header_change_while_he_composes_keeps_his_marked_text() throws {
        let (screen, height) = try page(header: 100)
        let line = try type(in: 29, on: screen)
        line.setMarkedText("今", selectedRange: NSRange(location: 1, length: 0))
        let marked = try #require(line.markedTextRange)
        let markedRange = NSRange(
          location: line.offset(from: line.beginningOfDocument, to: marked.start),
          length: line.offset(from: marked.start, to: marked.end))
        let snapshots = screen.controller.appliedSnapshots
        let before = frameInWindow(line)

        height.constant = 300
        screen.controller.headerDidChange()
        _ = screen.list

        let after = try #require(line.markedTextRange, "his marked text is still marked")
        #expect(line.offset(from: line.beginningOfDocument, to: after.start) == markedRange.location)
        #expect(line.offset(from: after.start, to: after.end) == markedRange.length)
        #expect(line.text == "Li今ne 30")
        #expect(screen.controller.isComposing)
        #expect(screen.controller.appliedSnapshots == snapshots, "no snapshot was applied")
        #expect(abs(frameInWindow(line).minY - before.minY) < 0.5)
        line.unmarkText()
      }
    }
  }
#endif
