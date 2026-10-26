import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/delete-account')({
  server: {
    handlers: {
      POST: async ({ request }) => (await import('../../../server/auth/server.ts')).handleDeleteAccount(request),
    },
  },
})
