// The minute's reminders, from a Cron Trigger inside the Worker (B60): no outside pinger. A cron has no request, so it opens its own database connection, as the gate does for one.
import { definePlugin } from 'nitro'

export default definePlugin(nitro => {
  nitro.hooks.hook('cloudflare:scheduled', async () => {
    const [{ withRequestDatabase }, { scheduledTick }] = await Promise.all([import('../storage.ts'), import('./server.ts')])
    await withRequestDatabase(scheduledTick)
  })
})
