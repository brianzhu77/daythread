import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from '@tanstack/react-router'
import { Analytics } from '@vercel/analytics/react'
import { AppShell } from '../components/app-shell'
import '../styles.css'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      // viewport-fit=cover lets the capture bar sit above the iPhone home indicator.
      { name: 'viewport', content: 'width=device-width, initial-scale=1, interactive-widget=resizes-content, viewport-fit=cover' },
      // B52: the page's colour (--gray-1 in each scheme), so Safari's bars match it.
      { name: 'theme-color', content: '#ffffff', media: '(prefers-color-scheme: light)' },
      { name: 'theme-color', content: '#111111', media: '(prefers-color-scheme: dark)' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      // B52b: in the Home Screen app the page reaches under the status bar and env(safe-area-inset-top) is its height,
      // so B52's strip covers what scrolls there. iOS 26 keeps the clock dark over our white (Roadbuster 3ddfd8f4).
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { title: 'Daythread' },
    ],
    // B52b: the Home Screen app is the whole site, wherever its icon was added from (without this, an icon added on a
    // day page showed a browser bar on Tasks and the review).
    links: [{ rel: 'manifest', href: '/manifest.webmanifest' }],
  }),
  component: Root,
  notFoundComponent: () => (
    <div className="empty">
      <h1>Page not found</h1>
      <a href="/">Back to today</a>
    </div>
  ),
})

function Root() {
  // The sign-in and sign-up screens stand alone: the app frame would load the workspace.
  const signIn = useRouterState({ select: s => s.location.pathname === '/sign-in' || s.location.pathname === '/sign-up' })
  return (
    <html lang="en">
      <head>
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
