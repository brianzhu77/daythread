/**
 * True on a hosting platform (Vercel, Netlify, Cloudflare Workers), where the local-only switches (auth off, SQLite,
 * loopback link previews) are refused. Workers are recognised by the runtime itself, so a missing variable can't
 * turn the guard off.
 */
export function onHostingPlatform(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VERCEL || env.NETLIFY) || onWorkers()
}

/** True inside the Cloudflare Workers runtime (wrangler dev included). */
export const onWorkers = (): boolean => globalThis.navigator?.userAgent === 'Cloudflare-Workers'
