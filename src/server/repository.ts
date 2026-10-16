import type { Command, CommandResult, Workspace } from "../domain/types";

export interface WorkspaceRepository {
  load(): Promise<Workspace>;
  execute(command: Command): Promise<CommandResult>;
}
