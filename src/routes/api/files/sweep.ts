import { createFileRoute } from '@tanstack/react-router'

// R3-11: files nothing holds any more, asked for by the app when it opens, at most once a day. If the workspace can't be read, nothing goes.
export const Route = createFileRoute('/api/files/sweep')({
  server: {
    handlers: {
      POST: async () => {
        const [{ getRepository }, { fileStore, idsHeldIn, sweepFiles }] = await Promise.all([import('../../../server/storage.ts'), import('../../../server/file-store.ts')])
        const removed = await sweepFiles(await fileStore(), idsHeldIn(await getRepository().heldText()), Date.now())
        return Response.json({ removed }, { headers: { 'cache-control': 'no-store' } })
      },
    },
  },
})
