import { createFileRoute } from '@tanstack/react-router'

// B3 export: a zip of his pages as Markdown plus workspace.json. Behind the same sign-in gate as every route, read-only,
// never cached (Lead 1ce5dd8b).
export const Route = createFileRoute('/api/export')({
  server: {
    handlers: {
      GET: async () => {
        const [{ getRepository }, { exportFiles }, { zipSync, strToU8 }] = await Promise.all([import('../../server/storage.ts'), import('../../domain/export.ts'), import('fflate')])
        const now = new Date(), files = exportFiles(await getRepository().load(), now)
        const zip = zipSync(Object.fromEntries(files.map(f => [f.path, [strToU8(f.text), { mtime: now }]])), { level: 6 })
        const name = files[0]!.path.split('/')[0]
        return new Response(zip, {
          headers: {
            'content-type': 'application/zip',
            'content-disposition': `attachment; filename="${name}.zip"`,
            'cache-control': 'no-store, private',
          },
        })
      },
    },
  },
})
