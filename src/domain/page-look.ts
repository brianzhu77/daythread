// A page's cover (docs/design/icons-covers.md §7.5). A link, never a copy: the browser fetches it and the server never does.
import { uploadedPicture } from './page-icon.ts'

export const coverLinkLimit = 2000
export function isCoverLink(value: string): boolean {
  if (!value || value.length > coverLinkLimit) return false
  // Ours: one from the small set, or an upload, which only its own account can read (R3-11).
  if (/^\/covers\/[a-z-]+\.svg$/.test(value) || uploadedPicture.test(value)) return true
  try { const { protocol } = new URL(value); return protocol === 'https:' || protocol === 'http:' } catch { return false }
}
/** How far along the crop it sits: 0 the picture's top, 1 its bottom. So the same setting shows the same part at any size, as far as that size allows. */
export const coverPlace = (position: number) => Math.round(Math.min(1, Math.max(0, position)) * 10_000) / 10_000
