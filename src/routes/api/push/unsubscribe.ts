import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/push/unsubscribe')({
  server: {
    handlers: {
      POST: async ({ request }) => (await import('../../../server/push/server.ts')).handleUnsubscribe(request),
    },
  },
})
