// `vite preview` doesn't put .env.local into process.env, so the server reads the keys it needs itself: only keys
// matching `keys`, values already in the environment win, nothing is logged. DATABASE_URL is never read from here.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'

export function readLocalEnv(keys: RegExp, path = resolve('.env.local')): void {
  if (!existsSync(path)) return
  const parsed = parseEnv(readFileSync(path, 'utf8'))
  for (const [key, value] of Object.entries(parsed)) if (keys.test(key) && process.env[key] === undefined) process.env[key] = value
}
