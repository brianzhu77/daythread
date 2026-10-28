import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/resend')({
  server: {
    handlers: {
      POST: async ({ request }) => (await import('../../../server/auth/server.ts')).handleResend(request),
    },
  },
})
