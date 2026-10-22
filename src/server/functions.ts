import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { commandSchema } from "../domain/command-schema";

export const loadWorkspace = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({operationId:z.string().min(1).max(200),triggerOperationId:z.string().max(200).optional()}).parse(input))
  .handler(async ({data}) => {
    const { getRepository } = await import("./storage");
    const { debugLog, debugEnabled, withLogOperation } = await import("./debug-log");
    const started=performance.now();
    debugLog('request.load.start',data);
    try {
      const { expireDrafts } = await import("./model/service");
      await expireDrafts().catch(()=>undefined);
      const workspace=await withLogOperation(data.operationId,()=>getRepository().load());
      const { modelInfo } = await import("./model/service");
      const model=await modelInfo();
      debugLog('request.load.finish',{...data,afterRevision:workspace.revision,elapsedMs:performance.now()-started,result:'ok'});
      const { forBrowser } = await import("./browser-workspace");
      return {workspace:forBrowser(workspace),debug:debugEnabled(),model};
    } catch(error) {
      debugLog('request.load.finish',{...data,elapsedMs:performance.now()-started,result:'error',error:error instanceof Error?error.name:'UnknownError'});
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

/**
 * Capture through the model (feat/model step 1). With no key, or the store not ready, it answers "simulated" and the
 * browser uses the existing capture command, so his words are never lost either way.
 */
export const submitCapture = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ operationId: z.string().min(1).max(200), pageId: z.string().min(1).max(200), text: z.string().min(1).max(20_000) }).parse(input))
  .handler(async ({ data }) => {
    const { submitCaptureForModel } = await import("./model/service");
    return submitCaptureForModel(data.operationId, data.pageId, data.text);
  });

export const retryCapture = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ operationId: z.string().min(1).max(200), captureId: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const { retryCaptureForModel } = await import("./model/service");
    return retryCaptureForModel(data.operationId, data.captureId);
  });

/** Draft my day (A6b step 1): real with the model ready, simulated otherwise; the browser follows the run. */
export const draftMyDay = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ operationId: z.string().min(1).max(200), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(input))
  .handler(async ({ data }) => {
    const { startDraftForDay } = await import("./model/service");
    return startDraftForDay(data.operationId, data.date);
  });
