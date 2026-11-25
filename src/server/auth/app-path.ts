// No server imports: the v1 route files import this statically, and it must stay out of what the client bundle pulls in.

/**
 * The native app's paths: it sends its session token as a bearer token, and the gate honours no cookie on them. The
 * router decodes the path and matches it case-insensitively, so the path is decoded (when it is well formed) and
 * lower-cased before the test: `/api/%761/x` and `/API/V1/x` are app paths as `/api/v1/x` is. A path the router
 * normalises some other way (`/api//v1/x`) is not one, which is why `appRoute` backs this up at the handler.
 */
export const isAppPath = (path: string): boolean => {
  let decoded = path
  try { decoded = decodeURI(path) } catch { /* malformed escape: the raw path */ }
  return decoded.toLowerCase().startsWith('/api/v1/')
}

/**
 * A v1 handler runs only for a request the gate itself saw as an app path, so it can never run under a cookie,
 * however the router spells or normalises the path: where the two disagree, the answer is 404.
 */
export const appRoute = (handler: (request: Request) => Promise<Response>) => async ({ request }: { request: Request }): Promise<Response> =>
  isAppPath(new URL(request.url).pathname) ? handler(request) : new Response('Not found', { status: 404 })
