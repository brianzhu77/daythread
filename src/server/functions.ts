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
      debugLog('request.load.finish',{...data,afterRevision:workspace.revision,elapsedMs:performance.now()-started,result:'ok'});
      return {workspace,debug:debugEnabled()};
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
