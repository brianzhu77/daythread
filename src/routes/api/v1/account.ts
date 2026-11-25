import { createFileRoute } from '@tanstack/react-router'
import { appRoute } from '../../../server/auth/app-path.ts'

export const Route = createFileRoute('/api/v1/account')({
  server: {
    handlers: {
      GET: appRoute(async request => (await import('../../../server/auth/server.ts')).handleAppAccount(request)),
    },
  },
})
