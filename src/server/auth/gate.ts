// The one gate in front of every request this server handles: pages, server functions and /api routes alike
// (Ratchet f6dc9688). Server-only code is loaded lazily, so nothing of it reaches the browser bundle.
import { createMiddleware } from '@tanstack/react-start'

export const authGate = createMiddleware().server(async ({ request, handlerType, next }) => {
  const [{ checkRequest }, { asOwner }] = await Promise.all([import('./server.ts'), import('./request-owner.ts')])
  const checked = await checkRequest(request, handlerType)
  return checked instanceof Response ? checked : asOwner(checked.owner, () => next())
})
