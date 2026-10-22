import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

// Vercel builds (and `DAYTHREAD_TARGET=vercel` locally) add Nitro, which emits Vercel's build output. Every other build
// stays exactly as before, so the app on the Mac (`vite preview` on 3000) is unchanged. Functions run in pdx1 (Oregon), next to
// the database; 60 s covers a model call, and work after the response uses waitUntil plus a durable job row (plan §3a).
const vercel = process.env.VERCEL === '1' || process.env.DAYTHREAD_TARGET === 'vercel'

export default defineConfig({
  plugins: [tailwindcss(), tanstackStart(), ...(vercel ? [nitro({ preset: 'vercel', vercel: { functions: { regions: ['pdx1'], maxDuration: 60 } } })] : []), viteReact()],
})
