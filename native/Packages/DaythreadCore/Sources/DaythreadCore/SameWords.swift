/// Words compared for "the same line": case, spacing and a trailing stop don't count (`sameWords`,
/// `day-draft.ts:70`). Lower-cased as JavaScript's `toLocaleLowerCase` does in an English locale, every run of `\s`
/// one space, a trailing run of `\s . 。 ! ！` dropped, trimmed as `String#trim`. The web's `toLocaleLowerCase()`
/// follows the browser's language, so a browser set to Turkish, Azeri or Lithuanian may read two lines as the same
/// (`I` and `ı`, say) where the app does not.
func sameWords(_ text: String) -> String {
  var scalars = String.UnicodeScalarView()
  var inRun = false
  for scalar in lowercasedAsJavaScript(text).unicodeScalars {
    if JavaScriptSpace.contains(scalar) {
      if !inRun { scalars.append(" ") }
      inRun = true
    } else {
      scalars.append(scalar)
      inRun = false
    }
  }
  while let last = scalars.last, JavaScriptSpace.contains(last) || stops.contains(last.value) {
    scalars.removeLast()
  }
  return JavaScriptSpace.trimmed(String(scalars))
}

/// `.`, `。` (U+3002), `!`, `！` (U+FF01).
private let stops: Set<UInt32> = [0x2E, 0x3002, 0x21, 0xFF01]

/// Unicode's default lower-casing scalar by scalar, with the one context rule JavaScript's lower-casing has in
/// English: a capital sigma ends a word as a final sigma (`Final_Sigma`: after a cased letter and not before one,
/// case-ignorable characters skipped). Swift's `lowercased()` has no such rule; `İ` lower-cases to `i` and a combining
/// dot above in both.
private func lowercasedAsJavaScript(_ text: String) -> String {
  let scalars = Array(text.unicodeScalars)
  var out = String.UnicodeScalarView()
  for (index, scalar) in scalars.enumerated() {
    if scalar.value == 0x3A3 {
      out.append(isFinalSigma(at: index, in: scalars) ? "\u{3C2}" : "\u{3C3}")
    } else {
      out.append(contentsOf: scalar.properties.lowercaseMapping.unicodeScalars)
    }
  }
  return String(out)
}

private func isFinalSigma(at index: Int, in scalars: [Unicode.Scalar]) -> Bool {
  var before = index - 1
  while before >= 0, scalars[before].properties.isCaseIgnorable { before -= 1 }
  guard before >= 0, scalars[before].properties.isCased else { return false }
  var after = index + 1
  while after < scalars.count, scalars[after].properties.isCaseIgnorable { after += 1 }
  return !(after < scalars.count && scalars[after].properties.isCased)
}
