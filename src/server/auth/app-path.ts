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

/** `application/json`, with or without parameters such as `; charset=utf-8`, in any case. */
const saysJson = (request: Request): boolean =>
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'application/json'

/**
 * A v1 handler runs only for a request the gate itself saw as an app path, so it can never run under a cookie,
 * however the router spells or normalises the path: where the two disagree, the answer is 404.
 *
 * A v1 write must say it is JSON, or it is 415 before the handler runs or the body is read. With sign-in off the gate's
 * only lock against a page in a browser is that a browser sends Origin or Sec-Fetch-Site; this is a second one, since
 * a page can send `text/plain` or a form without asking first, but not `application/json`. It runs after the gate, so
 * what the gate refuses (403, 401) keeps its status.
 */
export const appRoute = (handler: (request: Request) => Promise<Response>) => async ({ request }: { request: Request }): Promise<Response> => {
  if (!isAppPath(new URL(request.url).pathname)) return new Response('Not found', { status: 404 })
  if (request.method === 'POST' && !saysJson(request))
    return Response.json({ error: 'unsupported-media-type' }, { status: 415, headers: { 'cache-control': 'no-store' } })
  return handler(request)
}
