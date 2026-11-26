import DaythreadSync

/// The line under the title. A device that keeps nothing comes first, since a tick or a line typed there is lost at
/// the next launch. Then his words on this page that are not saved (`native-phase-1.md` §10.5), before what slice 1a
/// says about the copy: a draft the engine keeps and will not send; lack of network while he has words waiting; a
/// save that failed otherwise. Then a merge that put his words below the server's (§10.6), until he types again; then
/// lack of network with nothing of his waiting on this page, with what will be sent once it is back; then an update
/// that failed otherwise. Where the design does not order two lines, the one about his unsaved words comes first.
enum StatusLine {
  /// `pageId`: the page on screen, whose draft the line speaks of. `merged`: the last merge of that page put a line of
  /// his below the server's, and he has not typed since.
  static func text(state: SyncState, keepsChanges: Bool, pageId: String? = nil, merged: Bool = false) -> String? {
    if !keepsChanges { return "Changes aren't kept on this device" }
    let draft = pageId.flatMap { id in state.drafts.first { $0.id.utf8.elementsEqual(id.utf8) } }
    if case .stuck? = draft?.state { return "Couldn't save · draft kept" }
    if state.offline, draft != nil { return "Offline · saves when you're back" + willBeSent(state.pending) }
    if draft?.state == .retrying { return "Not saved yet · trying again" }
    if merged { return "Latest loaded · your changes are below their lines" }
    if state.offline { return "Offline · showing what was last loaded" + willBeSent(state.pending) }
    if state.failure != nil { return "Couldn't update · showing what was last loaded" }
    return nil
  }

  private static func willBeSent(_ pending: Int) -> String {
    switch pending {
    case 0: ""
    case 1: " · 1 change will be sent"
    case let count: " · \(count) changes will be sent"
    }
  }
}
