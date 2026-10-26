import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/push/tick')({
  server: {
    handlers: {
      GET: async ({ request }) => (await import('../../../server/push/server.ts')).handleTick(request),
    },
  },
})
