import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/push/subscribe')({
  server: {
    handlers: {
      POST: async ({ request }) => (await import('../../../server/push/server.ts')).handleSubscribe(request),
    },
  },
})
