# Reminders for `@date` chips, over web push

Status: built Oct 26 (PR 4 of 4) for Vercel's cron, and readied for Cloudflare on Nov 5 (B60). Brian, Oct 26: "for task 4, I'd like to use web push first."

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
2. **The tick.** A Cron Trigger inside the Worker runs it every minute (`src/server/push/cron.ts` on `infra/cloudflare`), with
   no outside pinger. `GET /api/push/tick` with `CRON_SECRET` stays for a host with no cron of its own. The tick walks every workspace with a subscription, computes what fell due in the last
   hour, sends what was not sent yet, and records it. A reminder counts as sent once one of the workspace's
   subscriptions took it; when every send failed it stays unsent and the next tick tries again. A subscription the
   push service reports gone (404, 410) is dropped. The response is a count: `{ workspaces, due, sent, gone, failed }`.
   **Turning on is a clean start:** a device gets only what falls due after it signed up, so a chip from just before stays
   quiet, and one from October is past the hour anyway. A chip on a ticked or cancelled to-do doesn't remind.
   **When reminders stop by themselves:** a device the push service drops stays as a row marked gone. If no device is left, a day's
   Events say "Reminders are off · Turn on here", on any device that can sign up, as long as a chip there is still to come. Turning
   them off yourself leaves no row, so it says nothing.
3. **The service worker** (`/sw.js`) shows the notification and opens the page on tap. It caches nothing and handles
   no fetches; the app is unchanged when it is not installed.

Sign-in and reminders both need Postgres: with SQLite (the Mac's 3000) the tick and subscribe answer 503.

## Setting it up

The VAPID keys are the Lead's to set, as repository secrets: `node scripts/vapid-keys.mjs` prints `DAYTHREAD_VAPID_PUBLIC_KEY` and
`DAYTHREAD_VAPID_PRIVATE_KEY`; `DAYTHREAD_VAPID_SUBJECT` (`mailto:…`) is optional, and without it the site's address is the subject.
The Cloudflare workflow passes them to the Worker. Without the keys the app shows no control and the cron does nothing. Brian then
taps Turn on reminders in the account row on each device and allows it. On an iPhone that's from the Home Screen app.

**What a tick costs (`tests/evidence/reminders/tick-cost.ts`, Node on local Postgres, a stand-in for the Worker):** about 1 ms of CPU at
his size (40 day pages of 40 lines) and about 32 ms with 10,000 rows, with nothing to skip because reading is this cheap. A minute's
cron is about 43,000 runs a month.

Local run without a push service: `DAYTHREAD_PUSH_TRANSPORT=log` makes the tick log each payload instead of sending,
and `scripts/push-smoke.mjs` drives the whole path in a browser with a stand-in `PushManager`.

## Not in this round

A lead time ("10 minutes before"), reminders for deadlines (`deadlineOn`) and for tasks planned on a day, and a
per-event switch. Each is a rule on top of `dueReminders`; the delivery path does not change.
