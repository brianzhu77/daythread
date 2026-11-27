/// What a row can be asked to do. `bringToToday` is `Bring to today` on a past day and `Plan for today` in a reference
/// row's swipe and menu (notice `On today`); `planForTodayButton` is only the reference row's own button
/// (notice `Planned for today`). `pickDate` is never sent: the screen turns it into `move` once he picks a day.
public enum RowAction: Hashable, Sendable {
  case move(LocalDate), pickDate, bringToToday, planForTodayButton, notToday, cancel, restore
}

/// What a to-do's row on a day page offers (`rowMenu` in `src/components/row-menu-model.ts`), as the web words it.
public struct RowMenu: Hashable, Sendable {
  public struct Item: Hashable, Sendable {
    public let title: String
    public let action: RowAction
    public let destructive: Bool
  }

  public struct Group: Hashable, Sendable {
    /// "Another day", or none.
    public let title: String?
    public let items: [Item]
  }

  /// Every action, in the web's `⋯` order: the circle's menu, ⌘/ and VoiceOver.
  public let groups: [Group]
  /// The trailing swipe's actions before `More`, with short titles (`Tomorrow`, the off item, `Plan for today`,
  /// `Bring to today`, `Restore`).
  public let swipe: [Item]
  /// What `More` holds, in the web's order: the Another day options, `Pick date…`, `Cancel task`. Empty: no `More`.
  public let more: [Item]

  /// `anotherDayOptions`, unlabelled: (`Tomorrow` | `This weekend` | `Next week`, date).
  public static func anotherDayOptions(today: LocalDate) -> [(label: String, date: LocalDate)] {
    let weekday = today.weekday
    let toSaturday = (6 - weekday + 7) % 7 == 0 ? 7 : (6 - weekday + 7) % 7
    let toMonday = (1 - weekday + 7) % 7 == 0 ? 7 : (1 - weekday + 7) % 7
    var options: [(label: String, date: LocalDate?)] = [("Tomorrow", today.adding(days: 1))]
    // Only Monday to Thursday: on Friday the weekend is tomorrow, and on Saturday or Sunday it would be next week's.
    if (1...4).contains(weekday) { options.append(("This weekend", today.adding(days: toSaturday))) }
    options.append(("Next week", today.adding(days: toMonday)))
    // Never two options for one day (on Sunday `Next week` is tomorrow).
    var found: [(label: String, date: LocalDate)] = []
    for case (let label, let date?) in options where !found.contains(where: { $0.date == date }) {
      found.append((label, date))
    }
    return found
  }

  /// `rowMenu`; nil when the row has no actions (done, or not on a day page). `planned` is the to-do's planned day.
  public static func of(
    task: TodoTask, role: RowRole, planned: LocalDate?, pageDate: LocalDate?, today: LocalDate
  ) -> RowMenu? {
    guard let pageDate else { return nil }
    if task.status == .done { return nil }
    if task.status == .cancelled { return only(Item(title: "Restore", action: .restore, destructive: false)) }
    if pageDate < today { return only(Item(title: "Bring to today", action: .bringToToday, destructive: false)) }

    // Never the page's own day: moving a row to the day it is on does nothing.
    var another = anotherDayOptions(today: today).filter { $0.date != pageDate }.map {
      Item(title: "\($0.label) · \(DayWords.shortLabel($0.date))", action: .move($0.date), destructive: false)
    }
    let pick = Item(title: "Pick date…", action: .pickDate, destructive: false)
    let cancel = Item(title: "Cancel task", action: .cancel, destructive: true)

    if role != .plan {
      let plan = planned == today ? [] : [Item(title: "Plan for today", action: .bringToToday, destructive: false)]
      return RowMenu(
        groups: (plan.isEmpty ? [] : [Group(title: nil, items: plan)])
          + [Group(title: "Another day", items: another + [pick]), Group(title: nil, items: [cancel])],
        swipe: plan, more: another + [pick, cancel])
    }

    let stale = planned != nil && planned != pageDate
    let off = Item(
      title: stale
        ? "Remove from \(DayWords.weekday(pageDate))"
        : pageDate == today ? "Not today" : "Not on \(DayWords.weekday(pageDate))",
      action: .notToday, destructive: false)
    var first: [Item] = []
    var swipeFirst: [Item] = []
    if pageDate == today, let tomorrow = today.adding(days: 1), planned != tomorrow {
      first = [Item(title: "Tomorrow · \(DayWords.longLabel(tomorrow))", action: .move(tomorrow), destructive: false)]
      swipeFirst = [Item(title: "Tomorrow", action: .move(tomorrow), destructive: false)]
      // Tomorrow is its own item on today's rows, so Another day does not repeat it.
      another.removeAll { $0.action == .move(tomorrow) }
    }
    return RowMenu(
      groups: [
        Group(title: nil, items: first + [off]), Group(title: "Another day", items: another + [pick]),
        Group(title: nil, items: [cancel]),
      ],
      swipe: swipeFirst + [off], more: another + [pick, cancel])
  }

  /// A past day's and a cancelled row's one action, in the swipe as well as the menu.
  private static func only(_ item: Item) -> RowMenu {
    RowMenu(groups: [Group(title: nil, items: [item])], swipe: [item], more: [])
  }
}
