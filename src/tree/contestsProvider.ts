import * as vscode from "vscode";
import { QueraService } from "../service";
import { icons, infoRow } from "./icons";


export class ContestSectionNode extends vscode.TreeItem {
  constructor(public readonly section: "active" | "finished", label: string, icon: string) {
    super(label, section === "active"
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = `contest-section-${section}`;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

export class ContestNode extends vscode.TreeItem {
  constructor(public readonly assignmentId: number, name: string, detail: string) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "contest";
    this.description = detail;
    this.iconPath = icons.contest();
    this.tooltip = `${name} (assignment #${assignmentId}) — expand for problems`;
  }
}

export class ContestProblemNode extends vscode.TreeItem {
  constructor(public readonly assignmentId: number, public readonly problemId: number, name: string) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "contestProblem";
    this.iconPath = icons.problem();
    this.command = {
      command: "queracode.openContestProblem",
      title: "Open",
      arguments: [assignmentId, problemId, name],
    };
  }
}

function infoItem(label: string, icon: string, command?: vscode.Command): vscode.TreeItem {
  const themed = icon === "sign-in" ? icons.signIn() : icon === "error" ? icons.error() : icons.info();
  return infoRow(label, themed, command);
}

export class ContestsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly service: QueraService) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem {
    return el;
  }

  private contestNode(entry: any): ContestNode {
    const contest = entry.contest || {};
    const aid = Number(entry.assignment ?? contest.assignment ?? 0);
    const name = contest.title || contest.name || entry.organizer_name || `Contest ${aid}`;
    const detail = [
      entry.duration_display,
      entry.user_cnt ? `${entry.user_cnt} 👤` : "",
      entry.problem_cnt ? `${entry.problem_cnt} problems` : "",
    ].filter(Boolean).join(" · ");
    return new ContestNode(aid, String(name), detail);
  }

  async getChildren(el?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!(await this.service.isSignedIn())) {
      return [infoItem("Sign in to see contests…", "sign-in", { command: "queracode.login", title: "Sign In" })];
    }
    try {
      const client = await this.service.getClient();
      if (!el) {
        return [
          new ContestSectionNode("active", "Active · فعال", "zap"),
          new ContestSectionNode("finished", "Finished · گذشته", "history"),
        ];
      }
      if (el instanceof ContestSectionNode) {
        const contests = await client.getContests();
        const list = el.section === "active" ? contests.active : contests.finished;
        if (!list.length) return [infoItem(el.section === "active" ? "No active contests right now." : "No finished contests listed.", "info")];
        return list.map((c) => this.contestNode(c)).filter((n) => n.assignmentId > 0);
      }
      if (el instanceof ContestNode) {
        const { items, emptyReason } = await client.listAssignmentContents(el.assignmentId, "contest");
        if (!items.length) {
          return [infoItem(emptyReason || "No problems visible in this contest.", "info")];
        }
        return items.map((p) => new ContestProblemNode(el.assignmentId, p.id, p.name));
      }
      return [];
    } catch (err: any) {
      return [infoItem(`Error: ${err?.message || err}`, "error")];
    }
  }
}
