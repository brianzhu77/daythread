// The answer to "the day's draft for this date", shared by the web's server function (`prepareDayDraft`) and the native
// app's route (`POST /api/v1/day-draft`), so the two clients are told the same thing by the same decision table.
import { draftOf, draftSettled, draftStale, DRAFT_RECIPE } from '../domain/day-draft.ts'
import type { LocalDate, Workspace } from '../domain/types.ts'
import { runDayDraft } from './model/day-draft.ts'
import type { ModelConfig } from './model/openrouter.ts'

/**
 * `setDraft`: the `set-draft` command as JSON text (a block's content is open-ended, as in a page's stored document), or
 * null when the day already has its draft. `owner`: whose workspace it was made from, so a client sends it only into that
 * one (Ratchet 727b9e22). `remakeFailed`: today's settled draft of an older recipe could not be made again; the client
 * counts it as a failed ask.
 */
export interface DayDraftReply { setDraft: string | null; owner: string; modelOn: boolean; remakeFailed: boolean }

/**
 * The day's draft for `date`, as `prepareDayDraft` has always answered it; null when `date` has no live daily page.
 * Stores nothing. Logs `draft.prepare` (counts and timings only) as before. `run` and `newId` are for tests.
 */
export async function dayDraftReply(
  ws: Workspace, date: LocalDate, owner: string, config: ModelConfig | null,
  options: { operationId: string; zone?: string; newId?: () => string; run?: typeof runDayDraft },
): Promise<DayDraftReply | null> {
  const page = ws.pages.find(p => p.type === 'daily' && p.date === date && !p.trashedAt)
  if (!page) return null
  // The first ready draft wins: a second tab or a reload never pays for, or replaces, another one. One an older
  // recipe made is made again, once, and only a ready one takes its place (Brian 3d7aca46).
  const old = draftOf(ws, page.id)
  const none: DayDraftReply = { setDraft: null, owner, modelOn: Boolean(config), remakeFailed: false }
  if (old && draftSettled(old) && !draftStale(old)) return none
  // Today's stale draft that can't be made again (no model for this account, or a failed answer) stays as it is, and the
  // client counts it as a failed ask, so it stops after two rather than asking on every focus (Ratchet 6f69e359).
  const notRemade: DayDraftReply = { ...none, remakeFailed: true }
  if (old && draftSettled(old) && !config) return notRemade
  const run = await (options.run ?? runDayDraft)(ws, page, config, options.newId ?? (() => crypto.randomUUID()), options.zone)
  console.info(JSON.stringify({ level: 'info', event: 'draft.prepare', operationId: options.operationId, model: Boolean(config), remade: Boolean(old && draftStale(old)), status: run.status, ...(run.error ? { error: run.error } : {}), items: run.items.length, returned: run.returned, kept: run.kept, drops: run.drops, carried: run.carried, moreOpen: run.moreOpen.length, elapsedMs: run.ms, costUsd: run.costUsd }))
  if (old && draftSettled(old) && run.status !== 'ready') return notRemade
  const action = { type: 'set-draft' as const, pageId: page.id, status: run.status, items: run.items, moreOpen: run.moreOpen, allowedTaskIds: run.allowedTaskIds, recipe: DRAFT_RECIPE }
  return { setDraft: JSON.stringify(action), owner, modelOn: Boolean(config), remakeFailed: false }
}
