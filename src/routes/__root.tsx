import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from '@tanstack/react-router'
import { AppShell } from '../components/app-shell'
import '../styles.css'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      // viewport-fit=cover lets the capture bar sit above the iPhone home indicator.
      { name: 'viewport', content: 'width=device-width, initial-scale=1, interactive-widget=resizes-content, viewport-fit=cover' },
      { name: 'theme-color', content: '#f6f5f0' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { title: 'Daythread' },
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

function Root() {
  // The sign-in screen stands alone: the app frame would load the workspace.
  const signIn = useRouterState({ select: s => s.location.pathname === '/sign-in' })
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
        <Scripts />
      </body>
    </html>
  )
}
