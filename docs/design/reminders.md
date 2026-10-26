# Reminders for `@date` chips, over web push

Status: built Oct 26 (PR 4 of 4). Brian, Oct 26: "for task 4, I'd like to use web push first."

## The rule

A `@date` chip in a line is an event (B27). A reminder is that event, pushed to the phone or the laptop:

- A chip with a time (`@Oct 28 3pm`) reminds **at that time**.
- A chip with only a date (`@Oct 28`) reminds **at 9:00 that morning**.
- Both in the **account's time zone** (the one in the account row), wherever the device is.
- **One notification per event**: its title is the line's words (the chip left out), the body the day and time, and a
  tap opens the page holding the line. The same event is never sent twice; a chip moved to another time is a new
  reminder.

Nothing is stored about reminders themselves: they are read from the documents, like the events. What is stored is
the browser's subscription (`daythread.push_subscriptions`, per workspace) and the keys of what was sent
(`daythread.push_sent`, kept a week).

## How it runs

1. **Turning it on.** The account row gets one control: **Turn on reminders**. The browser asks for permission,
   subscribes with the server's public key, and the server keeps the subscription with the workspace. Afterwards the
   row reads **Reminders on · Turn off**. Each device is its own subscription; a device that said no shows
   "Reminders blocked in the browser's settings". On an iPhone, Safari has no push outside the Home Screen app, so the
   row says "add Daythread to the Home Screen first" there (iOS 16.4 or later).
2. **The tick.** A scheduler calls `GET /api/push/tick` with `CRON_SECRET` (`Authorization: Bearer …` as Vercel's cron
   sends it, or `?token=…`). The tick walks every workspace with a subscription, computes what fell due in the last
   hour, sends what was not sent yet, and records it. A reminder counts as sent once one of the workspace's
   subscriptions took it; when every send failed it stays unsent and the next tick tries again. A subscription the
   push service reports gone (404, 410) is dropped. The response is a count: `{ workspaces, due, sent, gone, failed }`.
3. **The service worker** (`/sw.js`) shows the notification and opens the page on tap. It caches nothing and handles
   no fetches; the app is unchanged when it is not installed.

Sign-in and reminders both need Postgres: with SQLite (the Mac's 3000) the tick and subscribe answer 503.

## Setting it up (Brian)

1. Keys, once: `node scripts/vapid-keys.mjs` prints `DAYTHREAD_VAPID_PUBLIC_KEY` and `DAYTHREAD_VAPID_PRIVATE_KEY`.
   Put both in Vercel's environment (Production, and Preview if wanted). Optional `DAYTHREAD_VAPID_SUBJECT`
   (`mailto:you@example.com`); without it the site's address is the subject. Without the keys the app shows no
   reminders control at all.
2. `CRON_SECRET`: any long random string, in the same environment. Vercel's cron sends it on its own.
3. A scheduler, every minute (or every 5 if that is enough):
   - On a Vercel plan that allows it, `vercel.json`:
     `{ "crons": [{ "path": "/api/push/tick", "schedule": "* * * * *" }] }`. The Hobby plan runs crons at most once a
     day, which is useless here.
   - Otherwise any external pinger (cron-job.org, GitHub Actions every 5 minutes, a Raspberry Pi):
     `GET https://<the domain>/api/push/tick?token=<CRON_SECRET>`.
4. Deploy, open the app on the phone's Home Screen app, account row → **Turn on reminders**, allow. Write a line with
   `@` a time a few minutes ahead and wait.

Local run without a push service: `DAYTHREAD_PUSH_TRANSPORT=log` makes the tick log each payload instead of sending,
and `scripts/push-smoke.mjs` drives the whole path in a browser with a stand-in `PushManager`.

## Not in this round

A lead time ("10 minutes before"), reminders for deadlines (`deadlineOn`) and for tasks planned on a day, and a
per-event switch. Each is a rule on top of `dueReminders`; the delivery path does not change.
