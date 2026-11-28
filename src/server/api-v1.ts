// The native app's workspace, commands and saves over /api/v1: the web app's server functions as plain JSON, through
// the same rules (`runOutbox`, the store's revision check), so the two clients cannot drift apart.
import { z } from 'zod'
import { outboxCommandSchema, commandSchema } from '../domain/command-schema.ts'
import type { Receipt, Workspace } from '../domain/types.ts'
import type { WorkspaceChanges } from '../domain/workspace-changes.ts'
import { DomainError } from '../domain/workspace.ts'
import { forBrowser } from './browser-workspace.ts'
import { dayDraftReply, type DayDraftReply } from './day-draft-reply.ts'
import type { runDayDraft } from './model/day-draft.ts'
import type { ModelConfig } from './model/openrouter.ts'
import { runOutbox, type OutboxOutcome } from './outbox-command.ts'
import type { ServerRepository } from './repository.ts'

const noStore = { 'cache-control': 'no-store' }
const saveSchema = commandSchema.extend({ expectedOwner: z.string().min(1).max(200).optional() })
const badRequest = { status: 400, body: { error: 'bad-request' } } as const

/** The whole workspace, or just "nothing new" when the app already has this revision (it polls, and a workspace is large). */
export async function workspaceReply(repo: ServerRepository, owner: string, have: number | null): Promise<{ unchanged: true; revision: number; owner: string } | { workspace: Workspace; owner: string }> {
  const workspace = await repo.load()
  if (have !== null && have === workspace.revision) return { unchanged: true, revision: workspace.revision, owner }
  return { workspace: forBrowser(workspace), owner }
}

export async function commandReply(repo: ServerRepository, owner: string, body: unknown): Promise<{ status: 200; body: OutboxOutcome } | { status: 400; body: { error: 'bad-request' } }> {
  const command = outboxCommandSchema.safeParse(body)
  if (!command.success) return badRequest
  return { status: 200, body: await runOutbox(repo, owner, command.data) }
}

/** An editor save is checked against the whole revision, not a row basis: the app sends the document it read, so a stale one is refused, not merged. */
export async function saveReply(repo: ServerRepository, owner: string, body: unknown): Promise<{ status: 200; body: { receipt: Receipt; changes: WorkspaceChanges; owner: string } } | { status: 400; body: { error: 'bad-request' } } | { status: 409; body: { error: 'refused'; message: string } } | { status: 409; body: { error: 'owner-mismatch'; owner: string } }> {
  const parsed = saveSchema.safeParse(body)
  if (!parsed.success || parsed.data.action.type !== 'save-editor') return badRequest
  // Optional, so the web app and older clients are unaffected; a save made under one account must not land in another.
  const { expectedOwner, ...command } = parsed.data
  if (expectedOwner !== undefined && expectedOwner !== owner) return { status: 409, body: { error: 'owner-mismatch', owner } }
  try {
    const { receipt, changes } = await repo.execute(command)
    return { status: 200, body: { receipt, changes, owner } }
  } catch (error) {
    if (error instanceof DomainError) return { status: 409, body: { error: 'refused', message: error.message } }
    throw error
  }
}

export const dayDraftRequestSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), operationId: z.string().min(1).max(200) })

/**
 * The day's draft, as the web's `prepareDayDraft` answers it; nothing is stored, and the app sends `setDraft` itself
 * through /api/v1/commands. A date with no live day page is 404 `not-found` rather than the server function's throw,
 * which a v1 handler would turn into a 500 the app reads as "the server failed". An unexpected throw is still a 500.
 */
export async function dayDraftRouteReply(repo: ServerRepository, owner: string, config: ModelConfig | null, zone: string | undefined, body: unknown, run?: typeof runDayDraft): Promise<{ status: 200; body: DayDraftReply } | { status: 400; body: { error: 'bad-request' } } | { status: 404; body: { error: 'not-found' } }> {
  const parsed = dayDraftRequestSchema.safeParse(body)
  if (!parsed.success) return badRequest
  const reply = await dayDraftReply(await repo.load(), parsed.data.date, owner, config, { operationId: parsed.data.operationId, zone, ...(run ? { run } : {}) })
  return reply ? { status: 200, body: reply } : { status: 404, body: { error: 'not-found' } }
}

/** A `have` that is not a non-negative integer is as good as none: the app gets the whole workspace. */
export const haveOf = (request: Request): number | null => {
  const have = new URL(request.url).searchParams.get('have')
  return have !== null && /^\d+$/.test(have) && Number.isSafeInteger(Number(have)) ? Number(have) : null
}

const json = (status: number, body: unknown) => Response.json(body, { status, headers: noStore })
const jsonBody = (request: Request) => request.json().catch(() => null)

const context = async () => {
  const [{ getRepository }, { currentOwner }] = await Promise.all([import('./storage.ts'), import('./auth/request-owner.ts')])
  return { repo: getRepository(), owner: currentOwner() ?? 'local' }
}

export async function handleWorkspace(request: Request): Promise<Response> {
  const { repo, owner } = await context()
  return json(200, await workspaceReply(repo, owner, haveOf(request)))
}

export async function handleCommand(request: Request): Promise<Response> {
  const body = await jsonBody(request)
  const { repo, owner } = await context()
  const reply = await commandReply(repo, owner, body)
  return json(reply.status, reply.body)
}

export async function handleSave(request: Request): Promise<Response> {
  const body = await jsonBody(request)
  const { repo, owner } = await context()
  const reply = await saveReply(repo, owner, body)
  return json(reply.status, reply.body)
}

export async function handleDayDraft(request: Request): Promise<Response> {
  const body = await jsonBody(request)
  const [{ repo, owner }, { accountModel }, { accountOf }] = await Promise.all([context(), import('./model/access.ts'), import('./auth/server.ts')])
  // `accountOf(request)` is `currentAccount()` of the request being served, without reaching for the request context.
  const reply = await dayDraftRouteReply(repo, owner, await accountModel(), (await accountOf(request))?.timezone, body)
  return json(reply.status, reply.body)
}
