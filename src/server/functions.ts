import { createServerFn } from "@tanstack/react-start";
import { commandSchema } from "../domain/command-schema";

export const loadWorkspace = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getLocalRepository } = await import("./local-repository");
    return getLocalRepository().load();
  },
);
export const runCommand = createServerFn({ method: "POST" })
  .validator((input: unknown) => commandSchema.parse(input))
  .handler(async ({ data }) => {
    const { getLocalRepository } = await import("./local-repository");
    return getLocalRepository().execute(data);
  });
