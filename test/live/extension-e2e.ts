import * as path from "path";
import * as fs from "fs";

const NodeModule = require("module");
const mockPath = path.join(__dirname, "vscode-mock.ts");
const origResolve = NodeModule._resolveFilename;
NodeModule._resolveFilename = function (request: string, ...rest: any[]) {
  if (request === "vscode") return mockPath;
  return origResolve.call(this, request, ...rest);
};

const vscode = require("./vscode-mock") as typeof import("./vscode-mock");

const SESSION = process.env.QUERA_SESSION_ID || "";
const CLASS_ID = 28710;
const CLASS_ASSIGNMENT = 105409;
const COLLEGE_ID = 28258;
const CONTEST_ID = 105884;
const PROBLEMSET_PROBLEM = 3537;

interface Step { area: string; label: string; ok: boolean; evidence: string }
const steps: Step[] = [];
function check(area: string, label: string, ok: boolean, evidence: unknown = ""): boolean {
  const text = typeof evidence === "string" ? evidence : JSON.stringify(evidence);
  steps.push({ area, label, ok: !!ok, evidence: (text || "").slice(0, 240) });
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${area} — ${label}`);
  if (!ok) console.log(`         ${(text || "").slice(0, 240)}`);
  return !!ok;
}

const label = (item: any) => String(item?.label?.label ?? item?.label ?? "");
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeContext(): any {
  const store = new Map<string, any>();
  const secrets = new Map<string, string>([["queracode.sessionId", SESSION]]);
  return {
    subscriptions: [] as any[],
    extensionUri: vscode.Uri.file(path.resolve(__dirname, "../..")),
    extensionPath: path.resolve(__dirname, "../.."),
    globalState: {
      get: (k: string, d?: any) => (store.has(k) ? store.get(k) : d),
      update: async (k: string, v: any) => { store.set(k, v); },
      keys: () => [...store.keys()],
      setKeysForSync() {},
    },
    workspaceState: {
      get: (k: string, d?: any) => (store.has(k) ? store.get(k) : d),
      update: async (k: string, v: any) => { store.set(k, v); },
      keys: () => [...store.keys()],
    },
    secrets: {
      get: async (k: string) => secrets.get(k),
      store: async (k: string, v: string) => { secrets.set(k, v); },
      delete: async (k: string) => { secrets.delete(k); },
      onDidChange: new vscode.EventEmitter<any>().event,
    },
    extension: {
      id: "dwin-gharibi.queracode",
      packageJSON: require("../../package.json"),
    },
    globalStorageUri: vscode.Uri.file("/tmp/queracode-test-storage"),
    asAbsolutePath: (p: string) => path.resolve(__dirname, "../..", p),
    environmentVariableCollection: { replace() {}, append() {}, prepend() {}, clear() {} },
  };
}

async function main(): Promise<number> {
  if (!SESSION) { console.error("QUERA_SESSION_ID is required"); return 2; }

  console.log("\n=== activation ===");
  const ext = require("../../src/extension");
  const ctx = fakeContext();
  let activated = true;
  try {
    await ext.activate(ctx);
  } catch (e: any) {
    activated = false;
    check("activate", "extension activates", false, e?.message || String(e));
  }
  if (!activated) return 1;
  check("activate", "extension activates without throwing", true);
  check("activate", "every declared command is registered",
    vscode.commands._registry.size >= 70, vscode.commands._registry.size);

  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
  const declared: string[] = pkg.contributes.commands.map((c: any) => c.command);
  const missing = declared.filter((c) => !vscode.commands._registry.has(c));
  check("activate", "no declared command is missing at runtime", missing.length === 0, missing);
  for (const id of ["queracode.addLessonToAssignment", "queracode.addProblemToAssignment",
                    "queracode.editAssignmentProblem", "queracode.publishAssignmentEdit",
                    "queracode.deleteAssignmentProblem", "queracode.reorderAssignmentProblems",
                    "queracode.repoClone", "queracode.repoPull", "queracode.repoPush"]) {
    check("activate", `${id} is registered`, vscode.commands._registry.has(id));
  }

  const service = new (require("../../src/service").QueraService)(ctx);
  const { ProblemsetProvider } = require("../../src/tree/problemsetProvider");
  const { CoursesProvider } = require("../../src/tree/coursesProvider");
  const { ContestsProvider } = require("../../src/tree/contestsProvider");
  const { SubmissionsProvider } = require("../../src/tree/submissionsProvider");
  const { ToolsProvider } = require("../../src/tree/toolsProvider");
  const { LibraryProvider } = require("../../src/tree/libraryProvider");

  const isPlaceholder = (item: any) =>
    /sign in|no |could not|failed|error/i.test(label(item));

  console.log("\n=== Problemset tree ===");
  const problemset = new ProblemsetProvider(service);
  const psRoot = await problemset.getChildren();
  check("problemset-tree", "renders rows", psRoot.length > 0, psRoot.length);
  check("problemset-tree", "rows are problems, not a placeholder",
    psRoot.some((i: any) => !isPlaceholder(i)), psRoot.slice(0, 3).map(label));
  await pause(1500);

  console.log("\n=== Courses tree ===");
  const courses = new CoursesProvider(service);
  const sections = await courses.getChildren();
  check("courses-tree", "two root sections (colleges + classes)", sections.length === 2,
    sections.map(label));

  const collegeSection = sections[0];
  const collegeNodes = await courses.getChildren(collegeSection);
  check("courses-tree", "colleges are listed",
    collegeNodes.length > 0 && !isPlaceholder(collegeNodes[0]), collegeNodes.map(label));
  const targetCollege = collegeNodes.find((n: any) => n.collegeId === COLLEGE_ID);
  check("courses-tree", "the target college is present", !!targetCollege,
    collegeNodes.map((n: any) => n.collegeId));
  await pause(1500);

  if (targetCollege) {
    const chapters = await courses.getChildren(targetCollege);
    check("courses-tree", "college chapters load",
      chapters.length > 5 && !isPlaceholder(chapters[0]), chapters.slice(0, 3).map(label));
    if (chapters.length && !isPlaceholder(chapters[0])) {
      const lessons = await courses.getChildren(chapters[0]);
      check("courses-tree", "college lessons load under a chapter",
        lessons.length > 0 && !isPlaceholder(lessons[0]), lessons.slice(0, 3).map(label));
      check("courses-tree", "lesson nodes carry an open command",
        lessons.every((l: any) => !!l.command), lessons[0]?.command?.command);
    }
    await pause(1500);
  }

  const classSection = sections[1];
  const classNodes = await courses.getChildren(classSection);
  check("courses-tree", "LMS classes are listed",
    classNodes.length > 0 && !isPlaceholder(classNodes[0]), classNodes.map(label));
  const targetClass = classNodes.find((n: any) => Number(n.courseId) === CLASS_ID);
  check("courses-tree", "the target class is present", !!targetClass,
    classNodes.map((n: any) => n.courseId));
  await pause(1500);

  if (targetClass) {
    const chapters = await courses.getChildren(targetClass);
    check("courses-tree", "class chapters load",
      chapters.length > 0 && !isPlaceholder(chapters[0]), chapters.map(label));
    const chapter = chapters.find((c: any) => Number(c.chapterId) === CLASS_ASSIGNMENT) || chapters[0];
    if (chapter && !isPlaceholder(chapter)) {
      const items = await courses.getChildren(chapter);
      check("courses-tree", "class problems load under a chapter",
        items.length > 0 && !isPlaceholder(items[0]), items.map(label));
      check("courses-tree", "problem nodes carry an open command",
        items.every((i: any) => !!i.command), items[0]?.command?.command);
    }
    await pause(1500);
  }

  console.log("\n=== Contests tree ===");
  const contests = new ContestsProvider(service);
  const contestRoot = await contests.getChildren();
  check("contests-tree", "renders rows", contestRoot.length > 0, contestRoot.slice(0, 3).map(label));
  await pause(1500);

  console.log("\n=== Submissions tree ===");
  const submissions = new SubmissionsProvider(service);
  const subsRoot = await submissions.getChildren();
  check("submissions-tree", "renders without throwing", Array.isArray(subsRoot), subsRoot.length);

  console.log("\n=== Tools & Library trees ===");
  const tools = new ToolsProvider();
  const toolRoot = await tools.getChildren();
  check("tools-tree", "tool groups render", toolRoot.length > 0, toolRoot.map(label).slice(0, 4));
  if (toolRoot.length) {
    const kids = await tools.getChildren(toolRoot[0]);
    check("tools-tree", "a group expands to runnable entries", kids.length > 0,
      kids.slice(0, 3).map(label));
    check("tools-tree", "entries carry commands", kids.every((k: any) => !!k.command),
      kids[0]?.command?.command);
  }
  const library = new LibraryProvider(ctx);
  const libRoot = await library.getChildren();
  check("library-tree", "renders without throwing", Array.isArray(libRoot), libRoot.length);

  console.log("\n=== commands ===");
  vscode.recorded.error.length = 0;

  vscode.recorded.answers.set("inputBox", String(PROBLEMSET_PROBLEM));
  await vscode.commands.executeCommand("queracode.openProblem", PROBLEMSET_PROBLEM);
  check("commands", "openProblem renders a panel",
    vscode.recorded.panels.some((p) => p.html.length > 500),
    vscode.recorded.panels.map((p) => `${p.viewType}:${p.html.length}`).slice(-2));
  await pause(1500);

  await vscode.commands.executeCommand("queracode.openDashboard");
  check("commands", "dashboard renders",
    vscode.recorded.panels.some((p) => p.viewType.includes("dashboard") && p.html.length > 500),
    vscode.recorded.panels.map((p) => p.viewType).slice(-3));
  await pause(1500);

  await vscode.commands.executeCommand("queracode.refresh");
  check("commands", "refresh runs clean", true);

  const scaffoldRan = await vscode.commands.executeCommand("queracode.listCpTemplates")
    .then(() => true).catch(() => false);
  check("commands", "an offline tool command executes", scaffoldRan);

  check("commands", "no command surfaced an error dialog",
    vscode.recorded.error.length === 0, vscode.recorded.error.slice(0, 3));

  const failed = steps.filter((s) => !s.ok);
  console.log(`\n=== ${steps.length - failed.length}/${steps.length} checks passed ===`);
  for (const f of failed) console.log(`  FAIL [${f.area}] ${f.label}: ${f.evidence}`);
  return failed.length ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error("HARNESS THREW:", e);
  process.exit(1);
});
