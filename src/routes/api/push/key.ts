import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/push/key')({
  server: {
    handlers: {
      GET: async () => (await import('../../../server/push/server.ts')).handleKey(),
    },
  },
})
