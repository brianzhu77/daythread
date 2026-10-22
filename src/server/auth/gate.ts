// The one gate in front of every request this server handles: pages, server functions and /api routes alike
// (Ratchet f6dc9688). Server-only code is loaded lazily, so nothing of it reaches the browser bundle.
import { createMiddleware } from '@tanstack/react-start'

export const authGate = createMiddleware().server(async ({ request, handlerType, next }) => {
  const { checkRequest } = await import('./server.ts')
  return (await checkRequest(request, handlerType)) ?? next()
})
