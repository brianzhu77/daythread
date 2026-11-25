import { createFileRoute } from '@tanstack/react-router'
import { appRoute } from '../../../../server/auth/app-path.ts'

export const Route = createFileRoute('/api/v1/auth/sign-out')({
  server: {
    handlers: {
      POST: appRoute(async request => (await import('../../../../server/auth/server.ts')).handleAppSignOut(request)),
    },
  },
})
