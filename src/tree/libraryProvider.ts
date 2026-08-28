import * as vscode from "vscode";
import { icons } from "./icons";
import * as path from "path";
import { getSettings } from "../config";

type Entry = { label: string; detail: string; uri: vscode.Uri; kind: "problem" | "lesson" | "solution" };

class GroupNode extends vscode.TreeItem {
  constructor(public readonly kind: Entry["kind"], label: string, icon: string, public readonly entries: Entry[]) {
    super(`${label} (${entries.length})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = `library-${kind}`;
  }
}

export class LibraryProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem {
    return el;
  }

  private async collect(): Promise<Entry[]> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return [];
    const root = vscode.Uri.joinPath(folder.uri, getSettings().solutionsDir);
    const entries: Entry[] = [];
    const ls = async (uri: vscode.Uri) => {
      try { return await vscode.workspace.fs.readDirectory(uri); } catch { return []; }
    };
    for (const [name, kind] of await ls(vscode.Uri.joinPath(root, "problems"))) {
      if (kind !== vscode.FileType.Directory) continue;
      const dir = vscode.Uri.joinPath(root, "problems", name);
      let label = `Problem ${name}`;
      let detail = "";
      try {
        const meta = JSON.parse(Buffer.from(
          await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, "problem.json"))).toString());
        label = meta.name || label;
        detail = [meta.difficulty, meta.score !== undefined ? `${meta.score} pts` : ""].filter(Boolean).join(" · ");
      } catch {}
      entries.push({ label, detail, uri: vscode.Uri.joinPath(dir, "statement.md"), kind: "problem" });
    }
    for (const [name, kind] of await ls(vscode.Uri.joinPath(root, "lessons"))) {
      if (kind === vscode.FileType.File && name.endsWith(".md")) {
        entries.push({
          label: name.replace(/\.md$/, ""), detail: "درسنامه",
          uri: vscode.Uri.joinPath(root, "lessons", name), kind: "lesson",
        });
      }
    }
    for (const [name, kind] of await ls(root)) {
      if (kind === vscode.FileType.Directory && /^(problem|contest)-\d+/.test(name)) {
        entries.push({
          label: name, detail: "راه‌حل‌ها",
          uri: vscode.Uri.joinPath(root, name), kind: "solution",
        });
      }
    }
    return entries;
  }

  async getChildren(el?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (el instanceof GroupNode) {
      return el.entries.map((e) => {
        const item = new vscode.TreeItem(e.label);
        item.description = e.detail ? `· ${e.detail}` : "";
        item.iconPath = new vscode.ThemeIcon(
          e.kind === "problem" ? "symbol-event" : e.kind === "lesson" ? "book" : "folder-library");
        item.resourceUri = e.uri;
        item.contextValue = `libraryItem-${e.kind}`;
        item.command = e.kind === "solution"
          ? { command: "revealInExplorer", title: "Reveal", arguments: [e.uri] }
          : { command: "queracode.openLibraryItem", title: "Open", arguments: [e.uri.fsPath] };
        item.tooltip = e.uri.fsPath;
        return item;
      });
    }
    if (el) return [];
    const entries = await this.collect();
    if (!entries.length) {
      const hint = new vscode.TreeItem("Save a problem or author a lesson to build your library…");
      hint.iconPath = icons.library();
      return [hint];
    }
    const groups: [Entry["kind"], string, string][] = [
      ["problem", "Saved Problems · تمرین‌ها", "symbol-event"],
      ["lesson", "My Lessons · درسنامه‌ها", "book"],
      ["solution", "Solutions · راه‌حل‌ها", "folder-library"],
    ];
    return groups
      .map(([kind, label, icon]) => new GroupNode(kind, label, icon, entries.filter((e) => e.kind === kind)))
      .filter((g) => g.entries.length > 0);
  }
}

export async function openLibraryItem(fsPath: string): Promise<void> {
  const uri = vscode.Uri.file(fsPath);
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand("queracode.previewMarkdown");
  } catch {
    vscode.window.showWarningMessage(`Could not open ${path.basename(fsPath)} — was it moved?`);
  }
}
