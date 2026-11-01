import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { commandSchema } from "../domain/command-schema";

export const loadWorkspace = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ operationId: z.string().min(1).max(200), triggerOperationId: z.string().max(200).optional() }).parse(input))
  .handler(async ({ data }) => {
    const { getRepository } = await import("./storage");
    const { debugLog, debugEnabled, withLogOperation } = await import("./debug-log");
    const started = performance.now();
    debugLog('request.load.start', data);
    try {
      const workspace = await withLogOperation(data.operationId, () => getRepository().load());
      debugLog('request.load.finish', { ...data, afterRevision: workspace.revision, elapsedMs: performance.now() - started, result: 'ok' });
      const [{ forBrowser }, { currentOwner }] = await Promise.all([import("./browser-workspace"), import("./auth/request-owner")]);
      // `owner`: whose workspace this is, so the browser's offline copy is never another account's (pwa.md §2).
      return { workspace: forBrowser(workspace), owner: currentOwner() ?? "local", debug: debugEnabled() };
    } catch (error) {
      debugLog('request.load.finish', { ...data, elapsedMs: performance.now() - started, result: 'error', error: error instanceof Error ? error.name : 'UnknownError' });
      throw error;
    }
  });
export const runCommand = createServerFn({ method: "POST" })
  .validator((input: unknown) => commandSchema.parse(input))
  .handler(async ({ data }) => {
    const { getRepository } = await import("./storage");
    const [{ forBrowser }, { currentOwner }] = await Promise.all([import("./browser-workspace"), import("./auth/request-owner")]);
    const result = await getRepository().execute(data);
    return { ...result, workspace: forBrowser(result.workspace), owner: currentOwner() ?? "local" };
  });

/**
 * B77: a draft for a day page, from the model when this account has it on, else the app's fallback only. The model
 * is on when the server has OPENROUTER_API_KEY and OPENROUTER_MODEL and, with sign-in on, the account's email is in
 * DAYTHREAD_DRAFT_EMAILS (off by default for invited accounts, Bumblebee/Lead). Logs carry counts and timings only,
 * never his words or the model's reasons.
 *
 * Nothing is stored here: the reply is the `set-draft` command, and the tab sends it through its own command queue.
 * A write here would move the workspace on behind the tab's back, so a save he typed meanwhile, sent against the
 * revision the tab knew, would be refused (Lead 1d5e2e28). `set-draft` checks it all again and refuses to replace a
 * settled draft, so the first ready draft still wins. `setDraft` is that command as JSON (a block's content is open-ended,
 * as in a page's stored document), or null when the day already has its draft. `owner` is whose workspace it was made from: the tab sends it only into
 * that one (Ratchet 727b9e22).
 */
export const prepareDayDraft = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), operationId: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const [{ getRepository }, { currentOwner }, { currentAccount }, { modelConfig }, { runDayDraft }, { draftOf, draftSettled }] = await Promise.all([
      import("./storage"), import("./auth/request-owner"), import("./auth/server"), import("./model/openrouter"), import("./model/day-draft"), import("../domain/day-draft"),
    ]);
    const account = await currentAccount();
    const allowed = (process.env.DAYTHREAD_DRAFT_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    const config = modelConfig() && (!account || allowed.includes(account.email.toLowerCase())) ? modelConfig() : null;
    const ws = await getRepository().load();
    const page = ws.pages.find((p) => p.type === "daily" && p.date === data.date && !p.trashedAt);
    if (!page) throw new Error("Day page not found");
    // The first ready draft wins: a second tab or a reload never pays for, or replaces, another one.
    { const d = draftOf(ws, page.id); if (d && draftSettled(d)) return { setDraft: null, owner: currentOwner() ?? "local", modelOn: Boolean(config) }; }
    const run = await runDayDraft(ws, page, config, () => crypto.randomUUID());
    console.info(JSON.stringify({ level: "info", event: "draft.prepare", operationId: data.operationId, model: Boolean(config), status: run.status, items: run.items.length, moreOpen: run.moreOpen.length, elapsedMs: run.ms, costUsd: run.costUsd }));
    const action = { type: "set-draft" as const, pageId: page.id, status: run.status, items: run.items, moreOpen: run.moreOpen, allowedTaskIds: run.allowedTaskIds };
    return { setDraft: JSON.stringify(action), owner: currentOwner() ?? "local", modelOn: Boolean(config) };
  });

/**
 * Whether this server is the preview Worker (`DAYTHREAD_PREVIEW=1`, set at run time so the preview runs production's
 * own bundle, Lead c6fcc1da). Its data is separate, so the app marks itself: a note written there stays there.
 */
/** `build`: the id stamped into this build (vite.config.ts); a tab on another build moves onto this one (new-build.ts). */
export const getAppInfo = createServerFn({ method: "GET" }).handler(async () => ({ preview: process.env.DAYTHREAD_PREVIEW === "1", build: import.meta.env.VITE_DAYTHREAD_BUILD ?? "" }));

/** The signed-in account for "{email} · Sign out" and its time zone; null when sign-in is off. */
export const getAccount = createServerFn({ method: "GET" }).handler(async () => {
  const { currentAccount } = await import("./auth/server");
  const { timezones } = await import("./timezones");
  const account = await currentAccount();
  return { email: account?.email ?? null, timezone: account?.timezone ?? null, timezones: account ? timezones() : [] };
});

/** Where a plain line URL goes, resolved on the full workspace, with the address to open. */
export const resolveLineLink = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ pageId: z.string().min(1).max(200), lineId: z.string().min(1).max(200), taskId: z.string().min(1).max(200).optional() }).parse(input))
  .handler(async ({ data }) => {
    const { getRepository } = await import("./storage");
    const { resolveLine } = await import("../domain/page-refs");
    const { pagePath } = await import("../domain/line-link");
    const ws = await getRepository().load(), resolved = resolveLine(ws, data), page = ws.pages.find((p) => p.id === resolved.pageId);
    return { ...resolved, href: page ? pagePath(page, resolved.blockId) : null };
  });

/**
 * A bookmark page a paste just made takes the linked page's own title, and its description as a quote, read here
 * (link-preview.ts: public addresses only, short and small) and applied only while the page is untouched since the paste.
 */
export const previewLinkPage = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ pageId: z.string().min(1).max(200), url: z.string().min(1).max(10_000) }).parse(input))
  .handler(async ({ data }) => {
    const [{ fetchLinkPreview }, { getRepository }, { forBrowser }] = await Promise.all([import("./link-preview"), import("./storage"), import("./browser-workspace")]);
    const found = await fetchLinkPreview(data.url);
    if (!found.title && !found.description) return { applied: false as const };
    try {
      const result = await getRepository().executeOnLatest(`link-preview:${data.pageId}`, { type: "apply-link-preview", pageId: data.pageId, url: data.url, title: found.title, description: found.description });
      return { applied: result.receipt.message !== "Link page unchanged", workspace: forBrowser(result.workspace) };
    } catch {
      return { applied: false as const };
    }
  });
