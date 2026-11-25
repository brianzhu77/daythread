import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v1/auth/sign-in')({
  server: {
    handlers: {
      POST: async ({ request }) => (await import('../../../../server/auth/server.ts')).handleAppSignIn(request),
    },
  },
})
