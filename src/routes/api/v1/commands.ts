import { createFileRoute } from '@tanstack/react-router'
import { appRoute } from '../../../server/auth/app-path.ts'

export const Route = createFileRoute('/api/v1/commands')({
  server: {
    handlers: {
      POST: appRoute(async request => (await import('../../../server/api-v1.ts')).handleCommand(request)),
    },
  },
})
