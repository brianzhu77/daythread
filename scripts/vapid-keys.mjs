// One VAPID key pair for reminders (docs/design/reminders.md). Run once, put the two values in the environment
// (DAYTHREAD_VAPID_PUBLIC_KEY, DAYTHREAD_VAPID_PRIVATE_KEY), never in git. Usage: node scripts/vapid-keys.mjs
import webpush from 'web-push'
const { publicKey, privateKey } = webpush.generateVAPIDKeys()
console.log(`DAYTHREAD_VAPID_PUBLIC_KEY=${publicKey}\nDAYTHREAD_VAPID_PRIVATE_KEY=${privateKey}`)
