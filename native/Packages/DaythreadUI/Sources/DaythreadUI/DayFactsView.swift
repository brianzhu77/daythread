#if canImport(UIKit)
  import DaythreadCore
  import Observation
  import SwiftUI

  /// What the strip shows and what it was asked; the fold lives here, so a new host keeps it.
  @MainActor @Observable
  final class DayFactsModel {
    /// Set only through `show`.
    private(set) var facts: DayFacts = .none
    /// The `Not today` fold: closed at first, and closed again whenever the facts have no `Not today` part (he left
    /// today, or the list emptied).
    var notTodayOpen = false
    /// False while an action is out on the screen, or while today's page is being made: every control is disabled.
    var enabled = true
    /// The to-do a strip action is out for: its words in the tertiary colour.
    var acting: String?
    /// Each `Not today` row's menu button, in the hosting view's coordinates, by to-do: where the calendar is anchored.
    /// Not observed: the view writes it as it lays out, and nothing it draws reads it.
    @ObservationIgnored private(set) var menuFrames: [String: CGRect] = [:]
    @ObservationIgnored var onEvents: (() -> Void)?
    @ObservationIgnored var onBringBack: ((_ taskId: String) -> Void)?
    @ObservationIgnored var onAnotherDay: ((_ taskId: String, _ date: LocalDate) -> Void)?
    @ObservationIgnored var onPickDate: ((_ taskId: String) -> Void)?
    /// How many times `show` changed `facts` (tests read it).
    @ObservationIgnored private(set) var changes = 0

    /// Takes `facts` when they differ from those shown; returns whether they did.
    @discardableResult func show(_ facts: DayFacts) -> Bool {
      guard facts != self.facts else { return false }
      self.facts = facts
      if facts.notToday == nil { notTodayOpen = false }
      let listed = Set(facts.notToday?.rows.map(\.taskId) ?? [])
      menuFrames = menuFrames.filter { listed.contains($0.key) }
      changes += 1
      return true
    }

    /// What the view's controls call, also from tests: each reports only while `enabled`.
    func eventsTapped() {
      guard enabled else { return }
      onEvents?()
    }

    func bringBack(_ taskId: String) {
      guard enabled else { return }
      onBringBack?(taskId)
    }

    /// `onAnotherDay` for `.move(date)`, `onPickDate` for `.pickDate`; the menu offers nothing else.
    func choose(_ item: RowMenu.Item, for taskId: String) {
      guard enabled else { return }
      switch item.action {
      case .move(let date): onAnotherDay?(taskId, date)
      case .pickDate: onPickDate?(taskId)
      default: break
      }
    }

    func recordMenuFrame(_ frame: CGRect, of taskId: String) {
      menuFrames[taskId] = frame
    }
  }

  /// The strip above a day's page, under the title (`native-phase-1.md` §12.3): the events line, `Due soon` and the
  /// folded `Not today · N`, each absent when the facts have none. The system's parts, configured; the header's margins
  /// are its own, so it adds no horizontal padding.
  struct DayFactsView: View {
    let model: DayFactsModel

    /// The space the menu buttons' frames are read in: the hosting view's.
    nonisolated static let space = "DayFactsView"

    var body: some View {
      @Bindable var model = model
      let facts = model.facts
      VStack(alignment: .leading) {
        if let events = facts.events {
          EventsLineView(events: events, isButton: facts.eventsHeadingId != nil, model: model)
        }
        if !facts.dueSoon.isEmpty {
          GroupBox("Due soon") {
            VStack(alignment: .leading) {
              ForEach(facts.dueSoon, id: \.taskId) { row in
                FactRowView(row: row, acting: model.acting == row.taskId)
              }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
        if let notToday = facts.notToday {
          DisclosureGroup(notToday.title, isExpanded: $model.notTodayOpen) {
            VStack(alignment: .leading) {
              ForEach(notToday.rows, id: \.taskId) { row in
                NotTodayRowView(row: row, menu: notToday.menu, model: model)
              }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .coordinateSpace(.named(Self.space))
    }
  }

  /// The strip's host. Its view lies in the list's header, so UIKit has it be a child of the list's controller, which
  /// is not the day screen's to override: the screen learns of its height's changes here instead of through
  /// `preferredContentSizeDidChange(forChildContentContainer:)`.
  final class DayFactsHostingController: UIHostingController<DayFactsView> {
    /// Called when the height the strip asks for changes (`sizingOptions` has `.preferredContentSize`).
    var onPreferredContentSizeChange: (() -> Void)?

    override var preferredContentSize: CGSize {
      didSet {
        if preferredContentSize != oldValue { onPreferredContentSizeChange?() }
      }
    }
  }

  /// Today's events in one line, cut at its tail; `+N more` and the chevron are never cut. A button only when the page
  /// has an `Events` heading to scroll to.
  private struct EventsLineView: View {
    let events: EventsLine
    let isButton: Bool
    let model: DayFactsModel

    private var spoken: String { events.more.map { "\(events.text), \($0)" } ?? events.text }

    var body: some View {
      if isButton {
        Button(action: model.eventsTapped) { line(chevron: true) }
          .buttonStyle(.plain)
          .disabled(!model.enabled)
          // A button is one element already; only its words are given.
          .accessibilityLabel(spoken)
      } else {
        line(chevron: false)
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(spoken)
      }
    }

    private func line(chevron: Bool) -> some View {
      HStack {
        Label {
          Text(events.text).lineLimit(1).truncationMode(.tail)
        } icon: {
          Image(systemName: "calendar")
        }
        if let more = events.more {
          Text(more).fixedSize()
        }
        if chevron {
          Image(systemName: "chevron.right")
            .imageScale(.small)
            .foregroundStyle(.secondary)
            .fixedSize()
        }
      }
      .contentShape(Rectangle())
    }
  }

  /// A row's words and tag on one line, the tag at the end; the tag under the words when the two do not fit. The
  /// words wrap, the tag never does. One accessibility element, `spoken`.
  private struct FactRowView: View {
    let row: DayFacts.Row
    let acting: Bool

    var body: some View {
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .firstTextBaseline) {
          words
          Spacer(minLength: 0)
          tag
        }
        VStack(alignment: .leading) {
          words.fixedSize(horizontal: false, vertical: true)
          tag
        }
        // At the largest text sizes a tag alone can be wider than the strip (`Not today · Due today`): it wraps then,
        // rather than pushing the strip past the screen's edges or being cut.
        VStack(alignment: .leading) {
          words.fixedSize(horizontal: false, vertical: true)
          tag(wrapping: true)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(row.spoken)
    }

    private var words: some View {
      Text(row.words).foregroundStyle(acting ? .tertiary : .primary)
    }

    private var tag: some View { tag(wrapping: false) }

    @ViewBuilder private func tag(wrapping: Bool) -> some View {
      if let tag = row.tag {
        let text = Text(tag).font(.footnote).foregroundStyle(.secondary)
        if wrapping {
          text.fixedSize(horizontal: false, vertical: true)
        } else {
          text.lineLimit(1).fixedSize()
        }
      }
    }
  }

  /// A `Not today` row: its words and tag, then under them `Bring back` and the `Another day` menu.
  private struct NotTodayRowView: View {
    let row: DayFacts.Row
    let menu: RowMenu.Group
    let model: DayFactsModel

    var body: some View {
      VStack(alignment: .leading) {
        FactRowView(row: row, acting: model.acting == row.taskId)
        HStack {
          Button("Bring back") { model.bringBack(row.taskId) }
            .buttonStyle(.bordered)
          Menu {
            Section(menu.title ?? "") {
              ForEach(menu.items, id: \.self) { item in
                Button(item.title) { model.choose(item, for: row.taskId) }
              }
            }
          } label: {
            Image(systemName: "ellipsis")
          }
          .accessibilityLabel(row.menuLabel)
          .onGeometryChange(for: CGRect.self) { proxy in
            proxy.frame(in: .named(DayFactsView.space))
          } action: { frame in
            model.recordMenuFrame(frame, of: row.taskId)
          }
        }
        .disabled(!model.enabled)
      }
    }
  }
#endif
