import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/push/key')({
  server: {
    handlers: {
      GET: async ({ request }) => (await import('../../../server/push/server.ts')).handleKey(),
    },
  },
})
