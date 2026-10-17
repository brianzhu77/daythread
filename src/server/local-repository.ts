import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { applyCommand, createEmptyWorkspace } from "../domain/workspace.ts";
import type { Command, CommandResult, Workspace } from "../domain/types.ts";
import type { WorkspaceRepository } from "./repository.ts";

// Legacy JSON adapter retained for migration diagnostics/tests only. The application factory uses SQLite.
export class LocalWorkspaceRepository implements WorkspaceRepository {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly filePath: string;
  constructor(filePath: string) { this.filePath = filePath }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async read(): Promise<Workspace> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return createEmptyWorkspace();
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object")
      throw new Error("Local data is invalid; original file kept");
    const state = parsed as Workspace;
    if (
      state.schemaVersion !== 1 ||
      !Number.isInteger(state.revision) ||
      state.revision < 0 ||
      ![
        "pages",
        "tasks",
        "placements",
        "events",
        "materials",
        "captures",
      ].every((k) =>
        Array.isArray((state as unknown as Record<string, unknown>)[k]),
      ) ||
      !state.receipts ||
      typeof state.receipts !== "object"
    )
      throw new Error("Unsupported local data; original file kept");
    return state;
  }
  load(): Promise<Workspace> {
    return this.serial(() => this.read());
  }
  execute(command: Command): Promise<CommandResult> {
    return this.serial(async () => {
      const current = await this.read();
      const result = applyCommand(current, command);
      if (result.workspace.revision === current.revision) return result;
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporary = `${this.filePath}.${crypto.randomUUID()}.tmp`;
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(result.workspace));
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(temporary, this.filePath);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      return result;
    });
  }
}
