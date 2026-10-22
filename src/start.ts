import { createStart } from '@tanstack/react-start'
import { authGate } from './server/auth/gate'

/**
 * Every request goes through the sign-in gate. In the browser, a server function refused for a missing session sends
 * the page to sign-in; drafts stay on the device and save after signing in (Bumblebee 869d3f42).
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [authGate],
  serverFns: {
    fetch: async (input, init) => {
      const response = await fetch(input, init)
      if (response.status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/sign-in')
        window.location.assign(`/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`)
      return response
    },
  },
}))
