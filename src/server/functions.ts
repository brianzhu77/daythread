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
      const { forBrowser } = await import("./browser-workspace");
      return { workspace: forBrowser(workspace), debug: debugEnabled() };
    } catch (error) {
      debugLog('request.load.finish', { ...data, elapsedMs: performance.now() - started, result: 'error', error: error instanceof Error ? error.name : 'UnknownError' });
      throw error;
    }
  });
export const runCommand = createServerFn({ method: "POST" })
  .validator((input: unknown) => commandSchema.parse(input))
  .handler(async ({ data }) => {
    const { getRepository } = await import("./storage");
    const { forBrowser } = await import("./browser-workspace");
    const result = await getRepository().execute(data);
    return { ...result, workspace: forBrowser(result.workspace) };
  });

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
