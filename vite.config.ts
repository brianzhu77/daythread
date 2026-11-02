import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

// Hosted builds add Nitro: `DAYTHREAD_TARGET=cloudflare` emits a Worker (`.output/`, deployed with wrangler), Vercel
// builds (and `DAYTHREAD_TARGET=vercel`) emit Vercel's build output. Every other build stays exactly as before, so the
// app on the Mac (`vite preview` on 3000) is unchanged. Both run next to his Supabase project (us-east-1): Vercel in
// iad1, the Worker placed in aws:us-east-1, since a request makes several database round trips.
const target = process.env.DAYTHREAD_TARGET ?? (process.env.VERCEL === '1' ? 'vercel' : undefined)
const hosting = target === 'cloudflare'
  ? [nitro({
      preset: 'cloudflare-module',
      cloudflare: {
        deployConfig: true,
        nodeCompat: true,
        wrangler: {
          name: 'daythread',
          placement: { region: 'aws:us-east-1' },
          observability: { enabled: true },
          // Files are served at their own names: the Home Screen worker caches /offline.html, and a redirect to /offline
          // can't stand in for a navigation.
          assets: { html_handling: 'none' },
          vars: { DAYTHREAD_STORAGE: 'postgres' },
        },
      },
    })]
  : target === 'vercel'
    ? [nitro({ preset: 'vercel', vercel: { functions: { regions: ['iad1'], maxDuration: 120 } } })]
    : []

// One id per build, read by the client and the server bundles alike: an open tab whose id differs from the server's
// moves onto the new build when he comes back to it (new-build.ts). Set before Vite reads its VITE_ variables.
process.env.VITE_DAYTHREAD_BUILD ??= new Date().toISOString()

// B41: screens aren't split into separate downloads. A split screen fetched its code on first visit, and offline that
// fetch failed and the router reloaded the whole document: a blank app. The editor isn't split off either
// (continuous-page.tsx), for the same reason.
export default defineConfig({
  plugins: [tailwindcss(), tanstackStart({ router: { codeSplittingOptions: { defaultBehavior: [] } } }), ...hosting, viteReact()],
  define: { 'import.meta.env.DAYTHREAD_VERCEL_ANALYTICS': JSON.stringify(target === 'vercel') },
})
