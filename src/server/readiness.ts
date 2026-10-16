import { createServerFn } from '@tanstack/react-start'

// This checks the local Start server only. It makes no external requests.
export const getReadiness = createServerFn({ method: 'GET' }).handler(() => ({
  application: 'Daythread',
  phase: 'local-scaffold' as const,
  externalServices: 'not-connected' as const,
}))
