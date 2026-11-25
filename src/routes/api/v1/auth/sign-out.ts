import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v1/auth/sign-out')({
  server: {
    handlers: {
      POST: async ({ request }) => (await import('../../../../server/auth/server.ts')).handleAppSignOut(request),
    },
  },
})
