import DaythreadSync

/// The line under the title. A device that keeps nothing comes first, since a tick made there is lost at the next
/// launch; then lack of network, with what will be sent once it is back; then an update that failed otherwise.
enum StatusLine {
  static func text(state: SyncState, keepsChanges: Bool) -> String? {
    if !keepsChanges { return "Changes aren't kept on this device" }
    if state.offline {
      let line = "Offline · showing what was last loaded"
      switch state.pending {
      case 0: return line
      case 1: return "\(line) · 1 change will be sent"
      case let count: return "\(line) · \(count) changes will be sent"
      }
    }
    if state.failure != nil { return "Couldn't update · showing what was last loaded" }
    return nil
  }
}
