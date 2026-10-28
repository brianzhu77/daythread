# Invite note

The short message Brian sends each person he invites, after adding their address to the invite list. He sends it
himself (chat or email); the app sends nothing until they sign up. Replace `[name]` and `[address]`.

Facts it relies on (check before sending if any of these change):

- Sign-up is invite-only: the server refuses any address not on the list (`src/server/auth/server.ts`), so they must
  use the exact address he added.
- The confirmation email comes from Cloudflare SMTP with the Daythread template; the link lasts 24 hours if Email OTP
  Expiration was set to 86400 (Roadbuster ef35ec95). If it wasn't, change "a day" to "an hour".
- The interface is English only.
- Brian can technically read every account's pages: he owns the database. The team's usage reads cover his workspace
  only (rule from 2026-10-28). "I won't read them" is his promise to make; drop that sentence if he doesn't want to
  make it.

## English

> Hi [name], I'd like you to try Daythread, a small app I'm building: one page for each day, and unfinished to-dos come
> along to tomorrow.
>
> 1. Go to https://daythread.dogrod.com and choose "Create an account". Use [address]; it's invite-only, so another
>    address won't work.
> 2. Confirm from the email it sends (check spam). The link lasts a day.
> 3. On iPhone, open it in Safari, then Share, then "Add to Home Screen".
>
> Two honest notes: it's an early version, English only, and things may break, so tell me when they do. And since I run
> the server, I can technically see your pages. I won't read them.

## 中文

> [name]，想请你试试 Daythread，我在做的一个小应用：每天一页，没做完的待办会自动带到明天。
>
> 1. 打开 https://daythread.dogrod.com ，点 "Create an account"。请用 [address] 注册，只开放给受邀地址，换别的邮箱不行。
> 2. 去邮箱点确认链接（也看看垃圾邮件），链接一天内有效。
> 3. iPhone 上用 Safari 打开，点分享，再点"添加到主屏幕"。
>
> 两点先说清楚：这是早期版本，界面只有英文，可能会出问题，遇到了请告诉我。另外服务器是我在运行，技术上我能看到你的页面，但我不会去看。
