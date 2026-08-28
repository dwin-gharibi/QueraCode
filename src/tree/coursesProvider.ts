import * as vscode from "vscode";
import { icons } from "./icons";
import { faNum } from "../panels/render";
import { QueraService } from "../service";


export class SectionNode extends vscode.TreeItem {
  constructor(public readonly section: "colleges" | "classes", label: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = `section-${section}`;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

export class CourseNode extends vscode.TreeItem {
  constructor(public readonly courseId: number, name: string, detail?: string) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "course";
    this.iconPath = icons.class();
    this.description = detail ? `· ${detail}` : "";
    this.tooltip = `${name} (class #${courseId}) — expand for chapters`;
  }
}

export class CollegeNode extends vscode.TreeItem {
  constructor(public readonly collegeId: number, public readonly slug: string | undefined, name: string) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "college";
    this.iconPath = icons.college();
    this.tooltip = `${name} (college #${collegeId}) — expand for chapters`;
  }
}

export class ChapterNode extends vscode.TreeItem {
  constructor(public readonly chapterId: number, name: string, state?: string) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "chapter";
    this.description = state ? `· ${state}` : "";
    this.iconPath = icons.chapter();
    this.tooltip = `${name} (chapter/assignment #${chapterId}) — expand for lessons`;
  }
}

export class CollegeChapterNode extends vscode.TreeItem {
  constructor(
    public readonly collegeId: number,
    public readonly chapterId: number,
    name: string,
    passedPercent: number | undefined,
    public readonly items: { id: number; name: string; kind: "lesson" | "problem"; score?: number; completed?: boolean }[]
  ) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "collegeChapter";
    this.iconPath = icons.chapter();
    this.description = passedPercent !== undefined ? `· پیشرفت ${faNum(passedPercent)}٪` : "";
    this.tooltip = `${name} (chapter #${chapterId}) — ${items.length} items`;
  }
}

export class LessonNode extends vscode.TreeItem {
  constructor(
    public readonly chapterId: number,
    public readonly lessonId: number,
    name: string,
    kind: "lesson" | "problem" = "lesson",
    score?: number
  ) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = kind === "problem" ? "lmsProblem" : "lesson";
    this.iconPath = kind === "problem" ? icons.problem() : icons.lesson();
    this.description = kind === "problem" ? `· تمرین · ${score !== undefined ? faNum(score) : "؟"} نمره` : "· درسنامه";
    this.tooltip = `${name} (#${lessonId} in chapter #${chapterId}) — ${kind === "problem" ? `problem, ${score ?? "?"} pts` : "lesson"}`;
    this.command = kind === "problem"
      ? {
          command: "queracode.openProblemByUrl", title: "Open",
          arguments: [`course/assignments/${chapterId}/problems/${lessonId}`],
        }
      : { command: "queracode.readLesson", title: "Read", arguments: [chapterId, lessonId] };
  }
}

export class CollegeLessonNode extends vscode.TreeItem {
  public readonly lessonId: number;
  constructor(
    public readonly collegeId: number,
    public readonly chapterId: number,
    item: { id: number; name: string; kind: "lesson" | "problem"; score?: number;
      gainedScore?: number; answered?: boolean; completed?: boolean }
  ) {
    super(item.name, vscode.TreeItemCollapsibleState.None);
    this.lessonId = item.id;
    this.contextValue = item.kind === "problem" ? "collegeProblem" : "collegeLesson";
    const partial = (item.gainedScore ?? 0) > 0 && !item.completed;
    this.iconPath = item.completed
      ? icons.verdict(true)
      : partial
        ? new vscode.ThemeIcon("star-half", new vscode.ThemeColor("charts.yellow"))
        : item.kind === "problem" ? icons.problem() : icons.lesson();
    const attempted = item.answered || (item.gainedScore ?? 0) > 0 || item.completed;
    this.description = item.kind === "problem"
      ? attempted ? `· تمرین · ${faNum(item.gainedScore ?? 0)}/${item.score !== undefined ? faNum(item.score) : "؟"} نمره` : `· تمرین · ${item.score !== undefined ? faNum(item.score) : "؟"} نمره`
      : "· درسنامه";
    this.tooltip = `${item.name} (#${item.id}) — ${item.kind}` +
      (item.completed ? " · completed" : partial ? ` · ${item.gainedScore}/${item.score} so far` : "");
    this.command = {
      command: "queracode.readCollegeLesson", title: "Read",
      arguments: [collegeId, chapterId, item.id, item.name],
    };
  }
}

function infoItem(label: string, icon: string, command?: vscode.Command): vscode.TreeItem {
  const item = new vscode.TreeItem(label);
  item.iconPath = new vscode.ThemeIcon(icon);
  if (command) item.command = command;
  return item;
}

export function parseMyCollegeUrl(url: string | undefined): { id?: number; slug?: string } {
  const m = (url || "").match(/college\/(?:land\/college\/|landpage\/)?(\d+)(?:\/([^/?#]+))?/);
  if (!m) return {};
  return { id: Number(m[1]), slug: m[2] };
}

export class CoursesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private readonly service: QueraService) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem {
    return el;
  }

  async getChildren(el?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!(await this.service.isSignedIn())) {
      return [infoItem("Sign in to see your courses…", "sign-in",
        { command: "queracode.login", title: "Sign In" })];
    }
    try {
      const client = await this.service.getClient();
      if (!el) {
        return [
          new SectionNode("colleges", "Colleges · کالج‌ها", "mortar-board"),
          new SectionNode("classes", "Classes · کلاس‌ها", "organization"),
        ];
      }
      if (el instanceof SectionNode) {
        if (el.section === "colleges") {
          const user = await client.whoami();
          const colleges: any[] = user?.my_colleges || [];
          if (!colleges.length) {
            return [infoItem("No colleges found.", "info",
              { command: "queracode.openCourse", title: "Open Course" })];
          }
          return colleges.map((c) => {
            const parsed = parseMyCollegeUrl(c.url);
            return new CollegeNode(c.pk || c.id || parsed.id, parsed.slug, c.name || `College ${c.pk || c.id}`);
          });
        }
        const classes = await client.getClasses();
        if (!classes.items.length) {
          return [infoItem("No LMS classes found.", "info",
            { command: "queracode.openCourse", title: "Open Course" })];
        }
        return classes.items.map((c) =>
          new CourseNode(c.id, c.name, [c.instructor, c.term].filter(Boolean).join(" · ")));
      }
      if (el instanceof CollegeNode) {
        const tree = await client.getCollegeChapters(el.collegeId, el.slug);
        const chapters = tree.chapters.map((ch) =>
          new CollegeChapterNode(el.collegeId, ch.id, ch.name, ch.passedPercent, ch.items));
        return chapters.length ? chapters : [infoItem("No chapters visible in this college yet.", "info")];
      }
      if (el instanceof CollegeChapterNode) {
        const lessons = el.items.map((item) => new CollegeLessonNode(el.collegeId, el.chapterId, item));
        return lessons.length ? lessons : [infoItem("No lessons in this chapter yet.", "info")];
      }
      if (el instanceof CourseNode) {
        const course = await client.getCourse(el.courseId);
        const chapters = (course.assignments || []).map((a) => new ChapterNode(a.pk, a.name, a.state));
        return chapters.length ? chapters : [infoItem("No chapters in this course yet.", "info")];
      }
      if (el instanceof ChapterNode) {
        const items = await client.listAssignmentItems(el.chapterId);
        const lessons = items.map((p) => new LessonNode(el.chapterId, p.id, p.name, p.kind || "lesson", p.score));
        return lessons.length ? lessons : [infoItem("No lessons/problems visible in this chapter.", "info")];
      }
      return [];
    } catch (err: any) {
      return [infoItem(`Error: ${err?.message || err}`, "error")];
    }
  }
}
