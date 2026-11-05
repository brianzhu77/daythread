import { createFileRoute } from '@tanstack/react-router'
import { shownInPlace } from '../../../domain/body-files.ts'

// R3-11: a file's bytes. Behind the same sign-in gate as every route; the key comes from the session, so another account's id finds nothing.
export const Route = createFileRoute('/api/files/$fileId')({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        const { accountIsFull, fileStore, fileKey, fileSizeLimit, fileIdPattern } = await import('../../../server/file-store.ts')
        if (!fileIdPattern.test(params.fileId)) return Response.json({ error: 'bad-id' }, { status: 400 })
        const size = Number(request.headers.get('content-length'))
        if (!Number.isInteger(size) || size <= 0) return Response.json({ error: 'no-length' }, { status: 411 })
        if (size > fileSizeLimit) return Response.json({ error: 'too-large', limit: fileSizeLimit }, { status: 413 })
        if (!request.body) return Response.json({ error: 'empty' }, { status: 400 })
        const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream'
        const store = await fileStore()
        if (await accountIsFull(store, size)) return Response.json({ error: 'full' }, { status: 507 })
        const key = fileKey(params.fileId)
        if (await store.put(key, request.body, size, type)) return Response.json({ id: params.fileId, size, type }, { status: 201 })
        // Already there: a retry whose first try got through is fine, and anything else is refused.
        const there = await store.get(key)
        await there?.body.cancel()
        return there?.size === size ? Response.json({ id: params.fileId, size, type: there.type }) : Response.json({ error: 'taken' }, { status: 409 })
      },
      // Whether a block's file is there, without sending it (B87): a day with several photos mustn't fetch each one to find out.
      HEAD: async ({ params }) => {
        const { fileStore, fileKey, fileIdPattern } = await import('../../../server/file-store.ts')
        if (!fileIdPattern.test(params.fileId)) return new Response(null, { status: 404 })
        const file = await (await fileStore()).get(fileKey(params.fileId))
        await file?.body.cancel()
        return new Response(null, { status: file ? 200 : 404, headers: { 'cache-control': 'no-store' } })
      },
      GET: async ({ request, params }) => {
        const { fileStore, fileKey, fileIdPattern } = await import('../../../server/file-store.ts')
        if (!fileIdPattern.test(params.fileId)) return new Response(null, { status: 404 })
        const file = await (await fileStore()).get(fileKey(params.fileId))
        if (!file) return new Response('This file is gone.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
        if (request.headers.get('if-none-match') === file.etag) return new Response(null, { status: 304, headers: { etag: file.etag } })
        const name = new URL(request.url).searchParams.get('name')?.replace(/["\\\r\n]/g, '') || params.fileId
        return new Response(file.body, {
          headers: {
            'content-type': file.type,
            'content-length': String(file.size),
            'content-disposition': `${shownInPlace.has(file.type) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
            'x-content-type-options': 'nosniff',
            // A browser's PDF viewer won't open under `sandbox`; a PDF's scripts run in the viewer, not on this origin.
            'content-security-policy': file.type === 'application/pdf' ? "default-src 'none'" : "sandbox; default-src 'none'",
            'cache-control': 'private, no-cache',
            etag: file.etag,
          },
        })
      },
    },
  },
})
