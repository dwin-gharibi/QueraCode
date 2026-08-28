import * as vscode from "vscode";
import { QueraService } from "./service";


export async function registerMcpServer(interactive = true): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    if (interactive) vscode.window.showWarningMessage("Open a workspace folder to register QueraMCP.");
    return;
  }
  const mcpUri = vscode.Uri.joinPath(folder.uri, ".vscode", "mcp.json");
  let config: any = { servers: {} };
  try {
    const existing = await vscode.workspace.fs.readFile(mcpUri);
    config = JSON.parse(Buffer.from(existing).toString("utf8"));
    if (!config.servers) config.servers = {};
  } catch {
  }
  config.servers.quera = {
    command: "python",
    args: ["-m", "quera_mcp"],
    env: {
      QUERA_SESSION_ID: "${input:queraSessionId}",
      QUERA_ENABLE_SUBMISSION: "false",
      QUERA_ENABLE_WRITE: "false",
    },
  };
  if (!config.inputs) config.inputs = [];
  if (!config.inputs.some((i: any) => i.id === "queraSessionId")) {
    config.inputs.push({
      id: "queraSessionId",
      type: "promptString",
      description: "Quera session_id cookie",
      password: true,
    });
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, ".vscode"));
  await vscode.workspace.fs.writeFile(mcpUri, Buffer.from(JSON.stringify(config, null, 2)));
  if (interactive) {
    vscode.window.showInformationMessage(
      "Registered QueraMCP in .vscode/mcp.json — MCP-capable agents can now drive Quera. Install it with: pip install quera-mcp"
    );
  }
}

export interface QueraCodeApi {
  getClient: () => ReturnType<QueraService["getClient"]>;
  listProblems: (query: Record<string, string | string[]>, page: number) => Promise<unknown>;
  getProblem: (pk: number, tab?: string) => Promise<unknown>;
  isSignedIn: () => Promise<boolean>;
}

export function buildApi(service: QueraService): QueraCodeApi {
  return {
    getClient: () => service.getClient(),
    listProblems: async (query, page) => (await service.getClient()).listProblems(query, page),
    getProblem: async (pk, tab) => (await service.getClient()).getProblem(pk, tab),
    isSignedIn: () => service.isSignedIn(),
  };
}
