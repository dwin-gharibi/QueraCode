import * as vscode from "vscode";
import { icons } from "./icons";
import { outcomeOf } from "../constants";
import { faNum } from "../panels/render";
import type { SubmissionNode } from "../api/types";

export class SubmissionsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private groups = new Map<string, SubmissionNode[]>();

  refresh(): void {
    this._onDidChange.fire();
  }

  set(problemLabel: string, subs: SubmissionNode[]): void {
    this.groups.set(problemLabel, subs);
    this.refresh();
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem {
    return el;
  }

  getChildren(el?: vscode.TreeItem): vscode.TreeItem[] {
    if (!el) {
      if (!this.groups.size) {
        const item = new vscode.TreeItem("Open or submit to a problem to see submissions here.");
        item.iconPath = icons.submission();
        return [item];
      }
      return [...this.groups.keys()].map((label) => {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
        item.contextValue = "problemGroup";
        item.iconPath = icons.lesson();
        (item as any).groupKey = label;
        return item;
      });
    }
    const key = (el as any).groupKey as string;
    const subs = this.groups.get(key) || [];
    return subs.map((s) => {
      const o = outcomeOf(s);
      const item = new vscode.TreeItem(`#${s.pk} · ${o.fa}`, vscode.TreeItemCollapsibleState.None);
      item.contextValue = "submission";
      (item as any).pk = s.pk;
      item.description = o.score !== undefined ? `${faNum(o.score)}٪` : "";
      item.iconPath = o.pending
        ? new vscode.ThemeIcon("clock", new vscode.ThemeColor("charts.yellow"))
        : o.partial
          ? new vscode.ThemeIcon("star-half", new vscode.ThemeColor("charts.yellow"))
          : icons.verdict(o.accepted);
      item.tooltip = new vscode.MarkdownString(
        `**${o.fa}** · ${o.en}\n\n` +
          (o.score !== undefined ? `نمره: ${faNum(o.score)}٪\n\n` : "") +
          `submission #${s.pk}`
      );
      item.command = { command: "queracode.viewSubmissionResult", title: "Result", arguments: [s.pk] };
      return item;
    });
  }
}
