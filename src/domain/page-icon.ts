// A page's emoji (docs/design/icons-covers.md). One character as a person sees it, however many code points it takes; a title stays words.
const emojiLike = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u
export function isPageIcon(value: string): boolean {
  if (!value || value.length > 32 || !emojiLike.test(value)) return false
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length === 1
}
