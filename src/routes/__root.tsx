import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from '@tanstack/react-router'
import { Analytics } from '@vercel/analytics/react'
import { AppShell } from '../components/app-shell'
import { splashLinks } from '../components/splash'
import { getAppInfo } from '../server/functions'
import '../styles.css'

export const Route = createRootRoute({
  // Read once, on the server for the first page; offline or failed, it's production's frame (no preview marks).
  loader: async () => getAppInfo().catch(() => ({ preview: false })),
  staleTime: Infinity,
  head: ({ loaderData }) => ({
    meta: [
      { charSet: 'utf-8' },
      // viewport-fit=cover lets the capture bar sit above the iPhone home indicator.
      { name: 'viewport', content: 'width=device-width, initial-scale=1, interactive-widget=resizes-content, viewport-fit=cover' },
      // B52: the page's colour (--gray-1 in each scheme), so Safari's bars match it.
      { name: 'theme-color', content: '#ffffff', media: '(prefers-color-scheme: light)' },
      { name: 'theme-color', content: '#111111', media: '(prefers-color-scheme: dark)' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: loaderData?.preview ? 'DT Preview' : 'Daythread' },
      // B52b: in the Home Screen app the page reaches under the status bar and env(safe-area-inset-top) is its height,
      // so B52's strip covers what scrolls there. iOS 26 keeps the clock dark over our white (Roadbuster 3ddfd8f4).
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { title: loaderData?.preview ? 'Daythread Preview' : 'Daythread' },
    ],
    // B52b: the Home Screen app is the whole site, wherever its icon was added from (without this, an icon added on a
    // day page showed a browser bar on Tasks and the review).
    links: [
      { rel: 'manifest', href: loaderData?.preview ? '/manifest-preview.webmanifest' : '/manifest.webmanifest' },
      // The mark (docs/design/system-v2.md §6): the SVG favicon follows the tab's colour scheme; iOS takes the PNG tile.
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      // The launch screen in the Home Screen app (docs/design/pwa.md §3): the mark on the page's own colour.
      ...splashLinks(),
    ],
  }),
  component: Root,
  notFoundComponent: () => (
    <div className="empty">
      <h1>Page not found</h1>
      <a href="/">Back to today</a>
    </div>
  ),
})

/**
 * An emailed link lands on the Site URL (`/`) with its token or error in the fragment, which the server never sees.
 * Signed out, the server's redirect to /sign-in keeps the fragment; signed in, `/` is the app (from the server or the
 * service worker's copy) and would drop the link. This runs before the page paints and hands the fragment to
 * /sign-in, which reads it either way; also when only the fragment changes on an open page.
 */
const emailedLinkHandoff = `(function(){function f(){var p=new URLSearchParams(location.hash.slice(1));if(location.pathname!=='/sign-in'&&((p.get('access_token')&&p.get('type'))||p.get('error_code')))location.replace('/sign-in'+location.hash)}f();addEventListener('hashchange',f)})()`

function Root() {
  // The sign-in and sign-up screens stand alone: the app frame would load the workspace.
  const signIn = useRouterState({ select: s => s.location.pathname === '/sign-in' || s.location.pathname === '/sign-up' })
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: emailedLinkHandoff }} />
        <HeadContent />
      </head>
      <body>
        {signIn ? <Outlet /> : (
          <AppShell>
            <Outlet />
          </AppShell>
        )}
        <Analytics />
        <Scripts />
      </body>
    </html>
  )
}
