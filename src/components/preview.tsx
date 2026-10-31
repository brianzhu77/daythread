import { getRouteApi } from '@tanstack/react-router'

const root = getRouteApi('__root__')

/** True only on the preview Worker (DAYTHREAD_PREVIEW=1); production renders none of the preview marks. */
export function usePreview(): boolean {
  return root.useLoaderData()?.preview === true
}
