import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import '../styles.css'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Daythread · Local scaffold' },
    ],
  }),
  component: Root,
  notFoundComponent: () => <main><h1>Page not found</h1><a href="/">Back to Daythread</a></main>,
})

function Root() {
  return <html lang="en"><head><HeadContent /></head><body><Outlet /><Scripts /></body></html>
}
