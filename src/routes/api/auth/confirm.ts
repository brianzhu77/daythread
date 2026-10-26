import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/confirm')({
  server: {
    handlers: {
      POST: async ({ request }) => (await import('../../../server/auth/server.ts')).handleConfirm(request),
    },
  },
})
