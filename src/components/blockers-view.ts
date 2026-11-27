// What is blocked, and the words it is drawn with, as pure functions: never imports React or a .tsx file, so node --test
// and scripts/export-core-fixtures.ts reach it.
import { blockedNow, type Blocked } from '../domain/task-links.ts'
import { liveTaskIds } from '../domain/workspace.ts'
import type { Workspace } from '../domain/types.ts'

const worked = new WeakMap<Workspace, Map<string, Blocked>>()
/** Every to-do blocked now, worked out once for each copy of the workspace. */
export function blockedIn(ws: Workspace): Map<string, Blocked> {
  let found = worked.get(ws)
  if (!found) { found = blockedNow(ws, liveTaskIds(ws)); worked.set(ws, found) }
  return found
}

/** `Blocked by <title>` for one blocker, `Blocked by <n>` for more. */
export const blockedByWords = (blocked: Blocked): string =>
  blocked.by.length === 1 ? `Blocked by ${blocked.by[0]!.title}` : `Blocked by ${blocked.by.length}`
