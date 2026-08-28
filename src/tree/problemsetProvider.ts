import * as vscode from "vscode";
import { icons } from "./icons";
import { DIFFICULTIES, resolveTag } from "../constants";
import { QueraService } from "../service";
import type { ProblemSummary } from "../api/types";

export interface ProblemFilters {
  search?: string;
  difficulty?: string[];
  tag?: string[];
  type?: string[];
  category?: string[];
  solved?: string[];
  order?: string;
  page: number;
}

export class ProblemItem extends vscode.TreeItem {
  constructor(public readonly problem: ProblemSummary) {
    super(problem.name || `#${problem.pk}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "problem";
    const diff = DIFFICULTIES.find((d) => d.code === problem.difficulty);
    const solved = problem.solved_count ?? "?";
    const tried = problem.tried_count ?? "?";
    this.description = `${diff?.en ?? problem.difficulty ?? ""} · ${solved}/${tried}`;
    const rate = typeof problem.solved_count === "number" && typeof problem.tried_count === "number"
      && problem.tried_count > 0
      ? Math.round((problem.solved_count / problem.tried_count) * 100)
      : undefined;
    const tip = new vscode.MarkdownString(
      `### ${problem.name}\n\n` +
        `\`#${problem.pk}\`  ·  **${diff?.en ?? "?"}** · ${diff?.fa ?? ""}\n\n` +
        `حل‌شده ${solved} از ${tried} تلاش` +
        (rate !== undefined ? `  ·  نرخ قبولی **${rate}٪**` : "") + "\n\n" +
        ((problem.tags || []).length
          ? (problem.tags || []).map((t) => `\`${t.name}\``).join(" ") + "\n\n"
          : "") +
        "برای بازکردن کلیک کنید."
    );
    tip.supportThemeIcons = true;
    this.tooltip = tip;
    this.iconPath = icons.problem(problem.difficulty);
    this.command = { command: "queracode.openProblem", title: "Open", arguments: [problem.pk] };
  }
}

export class ProblemsetProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  filters: ProblemFilters = { page: 1 };
  private items: ProblemSummary[] = [];
  private total = 0;
  private loading = false;

  constructor(private readonly service: QueraService) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  setFilters(f: Partial<ProblemFilters>): void {
    this.filters = { ...this.filters, ...f, page: f.page ?? 1 };
    this.items = [];
    this.refresh();
  }

  clearFilters(): void {
    this.filters = { page: 1 };
    this.items = [];
    this.refresh();
  }

  async loadMore(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const client = await this.service.getClient();
      this.filters.page += 1;
      const page = await client.listProblems(this.query(), this.filters.page);
      this.items = [...this.items, ...page.items];
      this.total = page.total ?? this.total;
    } catch {
      this.filters.page -= 1;
    } finally {
      this.loading = false;
      this.refresh();
    }
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem {
    return el;
  }

  private query(): Record<string, string | string[]> {
    const q: Record<string, string | string[]> = {};
    const f = this.filters;
    if (f.search) q.search = f.search;
    if (f.difficulty?.length) q.difficulty = f.difficulty;
    if (f.type?.length) q.type = f.type;
    if (f.category?.length) q.category = f.category;
    if (f.solved?.length) q.solved = f.solved;
    if (f.order) q.order = f.order;
    if (f.tag?.length) {
      const ids = f.tag.map((t) => resolveTag(t)).filter((x): x is number => x !== undefined);
      if (ids.length) q.tag = ids.map(String);
    }
    return q;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    if (!(await this.service.isSignedIn())) {
      const item = new vscode.TreeItem("Sign in to Quera to browse problems…");
      item.command = { command: "queracode.login", title: "Sign In" };
      item.iconPath = icons.signIn();
      return [item];
    }
    try {
      if (!this.items.length) {
        const client = await this.service.getClient();
        const page = await client.listProblems(this.query(), this.filters.page);
        this.items = page.items;
        this.total = page.total ?? page.count;
      }
      const header = new vscode.TreeItem(
        `${this.items.length} loaded · ${this.total} total`,
        vscode.TreeItemCollapsibleState.None
      );
      header.iconPath = icons.filter();
      header.contextValue = "header";
      const nodes: vscode.TreeItem[] = [header, ...this.items.map((p) => new ProblemItem(p))];
      if (this.items.length < this.total) {
        const more = new vscode.TreeItem(
          this.loading ? "Loading…" : `Load more (${this.total - this.items.length} remaining)`
        );
        more.iconPath = this.loading ? icons.loading() : icons.more();
        more.command = { command: "queracode.loadMore", title: "Load more" };
        more.contextValue = "loadMore";
        nodes.push(more);
      }
      return nodes;
    } catch (err: any) {
      const item = new vscode.TreeItem(`Error: ${err?.message || err}`);
      item.iconPath = icons.error();
      return [item];
    }
  }
}
