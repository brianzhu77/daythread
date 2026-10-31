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
 * DAYTHREAD_DRAFT_EMAILS (off by default for invited accounts, Bumblebee/Lead). Stored with set-draft, checked again
 * there. Logs carry counts and timings only, never his words or the model's reasons.
 */
export const prepareDayDraft = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), operationId: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const [{ getRepository }, { forBrowser }, { currentOwner }, { currentAccount }, { modelConfig }, { runDayDraft }] = await Promise.all([
      import("./storage"), import("./browser-workspace"), import("./auth/request-owner"), import("./auth/server"), import("./model/openrouter"), import("./model/day-draft"),
    ]);
    const account = await currentAccount();
    const allowed = (process.env.DAYTHREAD_DRAFT_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    const config = modelConfig() && (!account || allowed.includes(account.email.toLowerCase())) ? modelConfig() : null;
    const repo = getRepository();
    let ws = await repo.load();
    const page = ws.pages.find((p) => p.type === "daily" && p.date === data.date && !p.trashedAt);
    if (!page) throw new Error("Day page not found");
    const { draftOf, draftSettled } = await import("../domain/day-draft");
    // The first ready draft wins: a second tab or a reload never pays for, or replaces, another one.
    { const d = draftOf(ws, page.id); if (d && draftSettled(d)) return { workspace: forBrowser(ws), owner: currentOwner() ?? "local", modelOn: Boolean(config) }; }
    const run = await runDayDraft(ws, page, config, () => crypto.randomUUID());
    console.info(JSON.stringify({ level: "info", event: "draft.prepare", operationId: data.operationId, model: Boolean(config), status: run.status, items: run.items.length, moreOpen: run.moreOpen.length, elapsedMs: run.ms, costUsd: run.costUsd }));
    const action = { type: "set-draft" as const, pageId: page.id, status: run.status, items: run.items, moreOpen: run.moreOpen, allowedTaskIds: run.allowedTaskIds };
    // The model takes seconds; if he saved meanwhile, store against the newer revision (set-draft re-checks it all).
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await repo.execute({ operationId: `${data.operationId}:${attempt}`, expectedRevision: ws.revision, action });
        return { ...result, workspace: forBrowser(result.workspace), owner: currentOwner() ?? "local", modelOn: Boolean(config) };
      } catch (error) {
        ws = await repo.load();
        const settled = draftOf(ws, page.id);
        if (settled && draftSettled(settled)) return { workspace: forBrowser(ws), owner: currentOwner() ?? "local", modelOn: Boolean(config) };
        if (attempt >= 2) throw error;
      }
    }
  });

/**
 * Whether this server is the preview Worker (`DAYTHREAD_PREVIEW=1`, set at run time so the preview runs production's
 * own bundle, Lead c6fcc1da). Its data is separate, so the app marks itself: a note written there stays there.
 */
export const getAppInfo = createServerFn({ method: "GET" }).handler(async () => ({ preview: process.env.DAYTHREAD_PREVIEW === "1" }));

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
