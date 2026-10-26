import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/reset-password')({
  server: {
    handlers: {
      POST: async ({ request }) => (await import('../../../server/auth/server.ts')).handleResetPassword(request),
    },
  },
})
