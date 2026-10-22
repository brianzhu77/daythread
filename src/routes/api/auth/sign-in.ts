import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/sign-in')({
  server: {
    handlers: {
      POST: async ({ request }) => (await import('../../../server/auth/server.ts')).handleSignIn(request),
    },
  },
})
