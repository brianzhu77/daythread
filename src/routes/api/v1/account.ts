import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/v1/account')({
  server: {
    handlers: {
      GET: async ({ request }) => (await import('../../../server/auth/server.ts')).handleAppAccount(request),
    },
  },
})
