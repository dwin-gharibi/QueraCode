import * as vscode from "vscode";
import * as path from "path";
import { collectLessons, findSyncRepo, LocalLesson, repoStatus, SyncConfig } from "../repo";
import { icons, infoRow } from "./icons";
import { faNum } from "../panels/render";


export class RepoRootNode extends vscode.TreeItem {
  constructor(public readonly root: string, public readonly config: SyncConfig, branch: string, dirty: number) {
    super(path.basename(root), vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "repoRoot";
    this.iconPath = icons.college();
    this.description = `${branch}${dirty ? ` · ${faNum(dirty)} تغییر ذخیره‌نشده` : ""}`;
    this.tooltip = new vscode.MarkdownString(
      `**مخزن کالج**\n\n\`${root}\`\n\nکالج #${config.college.college_id} · شاخهٔ \`${branch}\`\n\n` +
        `پروندهٔ درسنامه: \`${config.source.lesson_file}\``
    );
  }
}

export class RepoChapterNode extends vscode.TreeItem {
  constructor(
    public readonly root: string,
    public readonly config: SyncConfig,
    public readonly chapterName: string,
    public readonly localPath: string,
    lessons: LocalLesson[]
  ) {
    super(chapterName, lessons.length
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None);
    this.contextValue = "repoChapter";
    this.iconPath = icons.chapter();
    this.description = lessons.length ? `· ${faNum(lessons.length)} درسنامه` : "· خالی";
    this.tooltip = new vscode.MarkdownString(
      `**${chapterName}**\n\n\`${localPath}\`\n\n${lessons.length} درسنامه`
    );
  }
}

export class RepoLessonNode extends vscode.TreeItem {
  public readonly file: string;
  constructor(
    public readonly root: string,
    public readonly config: SyncConfig,
    public readonly lesson: LocalLesson
  ) {
    super(lesson.title, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "repoLesson";
    this.iconPath = icons.lesson();
    this.description = `· ${path.basename(lesson.dir)}`;
    this.file = path.join(root, config.source.root, lesson.dir, config.source.lesson_file);
    this.tooltip = new vscode.MarkdownString(
      `**${lesson.title}**\n\n\`${lesson.dir}\`\n\n` +
        "عنوان (اولین سرتیتر) کلیدی است که همگام‌سازی با آن درسنامه را پیدا می‌کند."
    );
    this.resourceUri = vscode.Uri.file(this.file);
    this.command = {
      command: "vscode.open", title: "Open",
      arguments: [vscode.Uri.file(this.file)],
    };
  }
}

export class RepoProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem {
    return el;
  }

  async getChildren(el?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const roots = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
    const found = await findSyncRepo(roots);
    if (!found) {
      return [
        infoRow("این پوشه به کالجی وصل نیست.", icons.info(),
          { command: "queracode.repoLink", title: "Link" },
          "یک کالج را به این مخزن وصل کنید تا درسنامه‌ها اینجا دیده شوند."),
        infoRow("کلون‌کردن یک مخزن کالج…", icons.library(),
          { command: "queracode.repoClone", title: "Clone" }),
      ];
    }

    if (!el) {
      let branch = "?";
      let dirty = 0;
      try {
        const st = await repoStatus(found.root);
        branch = st.branch;
        dirty = st.dirty.length;
      } catch {
        branch = "بدون گیت";
      }
      return [new RepoRootNode(found.root, found.config, branch, dirty)];
    }

    if (el instanceof RepoRootNode) {
      const lessons = await collectLessons(el.root, el.config);
      return el.config.chapters.map((c) =>
        new RepoChapterNode(el.root, el.config, c.name, c.local_path,
          lessons.filter((l) => l.chapter === c.name)));
    }

    if (el instanceof RepoChapterNode) {
      const lessons = await collectLessons(el.root, el.config);
      const mine = lessons.filter((l) => l.chapter === el.chapterName);
      if (!mine.length) {
        return [infoRow("درسنامه‌ای در این فصل نیست.", icons.info(),
          { command: "queracode.repoNewLesson", title: "New", arguments: [el] })];
      }
      return mine.map((l) => new RepoLessonNode(el.root, el.config, l));
    }

    return [];
  }
}
