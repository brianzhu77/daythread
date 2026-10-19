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
      const workspace=await withLogOperation(data.operationId,()=>getRepository().load());
      const { modelInfo } = await import("./model/service");
      const model=await modelInfo();
      debugLog('request.load.finish',{...data,afterRevision:workspace.revision,elapsedMs:performance.now()-started,result:'ok'});
      return {workspace,debug:debugEnabled(),model};
    } catch(error) {
      debugLog('request.load.finish',{...data,elapsedMs:performance.now()-started,result:'error',error:error instanceof Error?error.name:'UnknownError'});
      throw error;
    }
  });
export const runCommand = createServerFn({ method: "POST" })
  .validator((input: unknown) => commandSchema.parse(input))
  .handler(async ({ data }) => {
    const { getRepository } = await import("./storage");
    return getRepository().execute(data);
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
