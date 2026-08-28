import * as vscode from "vscode";
import * as path from "path";
import { getSettings } from "./config";


export interface VersionEntry {
  uri: vscode.Uri;
  timestamp: string;
  label: string;
  fileName: string;
}

function workspaceRoot(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("Open a workspace folder first.");
  return folder.uri;
}

function versionsDirFor(file: vscode.Uri): vscode.Uri {
  const root = workspaceRoot();
  const rel = path.relative(root.fsPath, file.fsPath).replace(/[\\/]/g, "__");
  return vscode.Uri.joinPath(root, getSettings().solutionsDir, ".versions", rel);
}

export async function snapshotFile(file: vscode.Uri, label = "manual"): Promise<vscode.Uri> {
  const dir = versionsDirFor(file);
  await vscode.workspace.fs.createDirectory(dir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = path.extname(file.fsPath);
  const target = vscode.Uri.joinPath(dir, `${stamp}__${label.replace(/[^\w.-]+/g, "_")}${ext}`);
  const bytes = await vscode.workspace.fs.readFile(file);
  await vscode.workspace.fs.writeFile(target, bytes);
  return target;
}

export async function listVersions(file: vscode.Uri): Promise<VersionEntry[]> {
  const dir = versionsDirFor(file);
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return [];
  }
  return entries
    .filter(([, kind]) => kind === vscode.FileType.File)
    .map(([name]) => {
      const [timestamp, rest] = name.split("__", 2);
      return {
        uri: vscode.Uri.joinPath(dir, name),
        timestamp: timestamp.replace(/T/, " ").replace(/-(\d{2})-(\d{3})Z?$/, ":$1"),
        label: (rest || name).replace(/\.[^.]*$/, ""),
        fileName: name,
      };
    })
    .sort((a, b) => (a.fileName < b.fileName ? 1 : -1));
}

export async function restoreVersion(file: vscode.Uri, snapshot: vscode.Uri): Promise<void> {
  await snapshotFile(file, "before-restore");
  const bytes = await vscode.workspace.fs.readFile(snapshot);
  await vscode.workspace.fs.writeFile(file, bytes);
}
