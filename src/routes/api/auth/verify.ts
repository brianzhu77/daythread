import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/verify')({
  server: {
    handlers: {
      POST: async ({ request }) => (await import('../../../server/auth/server.ts')).handleVerify(request),
    },
  },
})
