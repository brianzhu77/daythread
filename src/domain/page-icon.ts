// A page's icon (docs/design/icons-covers.md): an emoji, one of our own set, or an uploaded picture. A title stays words.
const emojiLike = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u
export const ownIcon = /^icon:[a-z0-9-]{1,40}$/
export const uploadedPicture = /^\/api\/files\/[A-Za-z0-9_-]{8,64}(\?[^\s]*)?$/
export function isPageIcon(value: string): boolean {
  if (ownIcon.test(value) || (value.length <= 300 && uploadedPicture.test(value))) return true
  if (!value || value.length > 32 || !emojiLike.test(value)) return false
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length === 1
}
