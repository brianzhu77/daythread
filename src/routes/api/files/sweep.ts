import { createFileRoute } from '@tanstack/react-router'

// R3-11: files nothing holds any more, asked for by the app when it opens, at most once a day. If the workspace can't be read, nothing goes.
// `?report=1` says what it would remove, and removes nothing.
export const Route = createFileRoute('/api/files/sweep')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [{ getRepository }, { fileStore, sweepFiles }] = await Promise.all([import('../../../server/storage.ts'), import('../../../server/file-store.ts')])
        const report = new URL(request.url).searchParams.get('report') === '1'
        const gone = await sweepFiles(await fileStore(), await getRepository().heldText(), Date.now(), { report })
        return Response.json({ report, removed: report ? 0 : gone.length, wouldRemove: report ? gone.map(f => ({ key: f.key, size: f.size, storedAt: f.storedAt })) : [] }, { headers: { 'cache-control': 'no-store' } })
      },
    },
  },
})
