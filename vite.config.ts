import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

// Vercel builds (and `DAYTHREAD_TARGET=vercel` locally) add Nitro, which emits Vercel's build output. Every other build
// stays exactly as before, so the app on the Mac (`vite preview` on 3000) is unchanged. Functions run in iad1, next to
// his Supabase project (us-east-1); 120 s covers a 60 s model call that continues after the response via waitUntil.
const vercel = process.env.VERCEL === '1' || process.env.DAYTHREAD_TARGET === 'vercel'

// One id per build, read by the client and the server bundles alike: an open tab whose id differs from the server's
// moves onto the new build when he comes back to it (new-build.ts). Set before Vite reads its VITE_ variables.
process.env.VITE_DAYTHREAD_BUILD ??= new Date().toISOString()

// B41: screens aren't split into separate downloads. A split screen fetched its code on first visit, and offline that
// fetch failed and the router reloaded the whole document: a blank app. The editor isn't split off either
// (continuous-page.tsx), for the same reason.
export default defineConfig({
  plugins: [tailwindcss(), tanstackStart({ router: { codeSplittingOptions: { defaultBehavior: [] } } }), ...(vercel ? [nitro({ preset: 'vercel', vercel: { functions: { regions: ['iad1'], maxDuration: 120 } } })] : []), viteReact()],
})
