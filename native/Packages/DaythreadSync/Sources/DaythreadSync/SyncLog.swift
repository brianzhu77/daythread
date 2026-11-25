import Foundation
import os

/// What the sync engine and the transport log, under subsystem `app.daythread.Daythread`, category `sync`. Only cases,
/// statuses, counts and identifiers are logged: never a token, a title or a document's text.
enum SyncLog {
  static let logger = Logger(subsystem: "app.daythread.Daythread", category: "sync")

  /// The error's case and status, never anything it carries from a person.
  static func describe(_ error: any Error) -> String {
    switch error {
    case let error as TransportError:
      switch error {
      case .offline: "offline"
      case .signedOut: "signed-out"
      // The reason is the server's error code (`bad-request`, `wrong`), never text a person wrote.
      case .refused(let status, let reason): "refused \(status) \(reason ?? "-")"
      case .wait(let seconds): "wait \(seconds)s"
      case .server(let status): "server \(status)"
      case .unreadable: "unreadable"
      }
    case let error as URLError: "URLError \(error.code.rawValue)"
    case is CancellationError: "cancelled"
    default: String(describing: type(of: error))
    }
  }
}
