// Sending one notification to one subscription over the Web Push protocol (VAPID, RFC 8292; payload encryption,
// RFC 8291) through the `web-push` package. The keys come from the environment; without them reminders are off and
// the app shows no control. DAYTHREAD_PUSH_TRANSPORT=log writes what would be sent instead of sending (local runs).
import webpush from 'web-push'
import type { PushSubscription } from './store.ts'

export interface PushConfig { publicKey: string; privateKey: string; subject?: string }
export interface PushPayload { key: string; title: string; body: string; url: string }
/** `gone`: the push service says the subscription no longer exists, so it is dropped; `failed`: try again later. */
export type SendResult = 'ok' | 'gone' | 'failed'
export type Sender = (subscription: PushSubscription, payload: PushPayload) => Promise<SendResult>

export function pushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const publicKey = env.DAYTHREAD_VAPID_PUBLIC_KEY, privateKey = env.DAYTHREAD_VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject: env.DAYTHREAD_VAPID_SUBJECT || undefined }
}

/** How long a push service keeps a reminder for a device that is offline: an hour, then it is stale anyway. */
const ttlSeconds = 3600

/** The real sender; `origin` is the site's address, the VAPID subject when none is configured. */
export function webPushSender(config: PushConfig, origin: string): Sender {
  const subject = config.subject ?? origin
  return async (subscription, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
        { vapidDetails: { subject, publicKey: config.publicKey, privateKey: config.privateKey }, TTL: ttlSeconds, urgency: 'high' },
      )
      return 'ok'
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) return 'gone'
      console.warn(JSON.stringify({ level: 'warn', event: 'push.failed', status: status ?? null, error: error instanceof Error ? error.message.slice(0, 200) : String(error) }))
      return 'failed'
    }
  }
}

/** For a local run with no push service: the payload goes to the log and counts as sent. */
export const logSender: Sender = async (subscription, payload) => {
  console.info(JSON.stringify({ level: 'info', event: 'push.log', endpoint: subscription.endpoint, payload }))
  return 'ok'
}

export function senderFor(config: PushConfig, origin: string, env: NodeJS.ProcessEnv = process.env): Sender {
  return env.DAYTHREAD_PUSH_TRANSPORT === 'log' ? logSender : webPushSender(config, origin)
}
