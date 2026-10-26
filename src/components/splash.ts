// iOS startup images (docs/design/pwa.md §3): one per iPhone size the app is likely to meet, in light and dark. iOS
// picks the link whose media query matches the device, so the sizes must be exact. scripts/render-icons.mjs renders
// the files from this same table.
export const splashSizes: { w: number; h: number; dpr: number }[] = [
  { w: 440, h: 956, dpr: 3 }, // 16 Pro Max, 17 Pro Max
  { w: 402, h: 874, dpr: 3 }, // 16 Pro, 17 Pro
  { w: 430, h: 932, dpr: 3 }, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { w: 393, h: 852, dpr: 3 }, // 14 Pro, 15, 15 Pro, 16, 17
  { w: 428, h: 926, dpr: 3 }, // 12 Pro Max, 13 Pro Max, 14 Plus
  { w: 390, h: 844, dpr: 3 }, // 12, 12 Pro, 13, 13 Pro, 14
  { w: 375, h: 812, dpr: 3 }, // X, XS, 11 Pro, 12 mini, 13 mini
  { w: 414, h: 896, dpr: 2 }, // XR, 11
  { w: 375, h: 667, dpr: 2 }, // SE
]
export const splashFile = (s: { w: number; h: number; dpr: number }, scheme: 'light' | 'dark') => `/splash/iphone-${s.w * s.dpr}x${s.h * s.dpr}-${scheme}.png`
const media = (s: { w: number; h: number; dpr: number }) => `(device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)`
/** The `<link rel="apple-touch-startup-image">` entries: dark first, with the scheme in the query, then light as the fallback. */
export const splashLinks = (): { rel: string; href: string; media: string }[] => [
  ...splashSizes.map(s => ({ rel: 'apple-touch-startup-image', href: splashFile(s, 'dark'), media: `${media(s)} and (prefers-color-scheme: dark)` })),
  ...splashSizes.map(s => ({ rel: 'apple-touch-startup-image', href: splashFile(s, 'light'), media: media(s) })),
]
