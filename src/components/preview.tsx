import { getRouteApi } from '@tanstack/react-router'
import { useEffect } from 'react'

const root = getRouteApi('__root__')
export const previewStorageKey = 'daythread.preview'

/**
 * True only on the preview Worker (DAYTHREAD_PREVIEW=1); production renders none of the preview marks. The answer is
 * kept in this browser, so an app that later boots offline, or whose call fails, keeps the frame it had: a preview never
 * passes for production (Ratchet 247d661c).
 */
export function usePreview(): boolean {
  const preview = root.useLoaderData()?.preview === true
  useEffect(() => {
    try { localStorage.setItem(previewStorageKey, preview ? '1' : '0') } catch { /* no storage: nothing to keep */ }
  }, [preview])
  return preview
}
