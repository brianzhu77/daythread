import Foundation

/// The server's origin (scheme, host and port), which is part of who the app is signed in to: the session's Keychain
/// item and the store's file are named after it, so a build pointed at one server and later at another keeps two
/// sessions and two copies, and never sends one server's token to the other.
struct ServerOrigin: Equatable {
  /// The origin lower-cased, with every character outside `[a-z0-9.-]` replaced by `-`; a scheme's default port is
  /// left out, as an origin leaves it out.
  let slug: String

  private static let defaultPorts = ["http": 80, "https": 443]

  init(_ url: URL) {
    let scheme = (url.scheme ?? "").lowercased()
    var origin = "\(scheme)://\(url.host(percentEncoded: false) ?? "")"
    if let port = url.port, port != Self.defaultPorts[scheme] { origin += ":\(port)" }
    slug = String(
      origin.lowercased().unicodeScalars.map { scalar -> Character in
        switch scalar {
        case "a"..."z", "0"..."9", ".", "-": Character(scalar)
        default: "-"
        }
      })
  }

  var keychainService: String { "app.daythread.Daythread.\(slug)" }
  var storeFileName: String { "workspace-\(slug).store" }
}
