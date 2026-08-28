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
const WORKDIR = "/tmp/queracode-cmd-sweep";
const TIMEOUT_MS = Number(process.env.SWEEP_TIMEOUT_MS || 60_000);

const SELF_DESTRUCTIVE = new Set(["queracode.logout", "queracode.login"]);

const MUTATING = new Set([
  "queracode.submitSolution", "queracode.quickSubmit", "queracode.submitFile",
  "queracode.publishLesson", "queracode.publishToAssignment", "queracode.publishAssignmentEdit",
  "queracode.addLessonToAssignment", "queracode.addProblemToAssignment",
  "queracode.editAssignmentProblem", "queracode.deleteAssignmentProblem",
  "queracode.reorderAssignmentProblems", "queracode.rejudge",
  "queracode.repoPush", "queracode.repoPull", "queracode.repoClone",
  "queracode.logout", "queracode.login",
]);

interface Row { command: string; outcome: string; detail: string }
const rows: Row[] = [];

function fakeContext(): any {
  const store = new Map<string, any>();
  const secrets = new Map<string, string>([["queracode.sessionId", SESSION]]);
  return {
    subscriptions: [] as any[],
    extensionUri: vscode.Uri.file(path.resolve(__dirname, "../..")),
    extensionPath: path.resolve(__dirname, "../.."),
    globalState: { get: (k: string, d?: any) => (store.has(k) ? store.get(k) : d),
                   update: async (k: string, v: any) => { store.set(k, v); },
                   keys: () => [...store.keys()], setKeysForSync() {} },
    workspaceState: { get: (k: string, d?: any) => (store.has(k) ? store.get(k) : d),
                      update: async (k: string, v: any) => { store.set(k, v); },
                      keys: () => [...store.keys()] },
    secrets: { get: async (k: string) => secrets.get(k),
               store: async (k: string, v: string) => { secrets.set(k, v); },
               delete: async (k: string) => { secrets.delete(k); },
               onDidChange: new vscode.EventEmitter<any>().event },
    globalStorageUri: vscode.Uri.file(`${WORKDIR}/storage`),
    asAbsolutePath: (p: string) => path.resolve(__dirname, "../..", p),
    environmentVariableCollection: { replace() {}, append() {}, prepend() {}, clear() {} },
  };
}

async function main(): Promise<number> {
  if (!SESSION) { console.error("QUERA_SESSION_ID is required"); return 2; }

  fs.rmSync(WORKDIR, { recursive: true, force: true });
  fs.mkdirSync(`${WORKDIR}/quera`, { recursive: true });
  const solution = `${WORKDIR}/quera/solution.py`;
  fs.writeFileSync(solution, "n = int(input())\nprint(n * 2)\n");
  const lesson = `${WORKDIR}/statement.md`;
  fs.writeFileSync(lesson, "# عنوان\n\nمتن آزمایشی با ![تصویر](images/x.png)\n");
  vscode.workspace.workspaceFolders = [
    { uri: vscode.Uri.file(WORKDIR), name: "sweep", index: 0 },
  ];

  const ext = require("../../src/extension");
  await ext.activate(fakeContext());

  const doc = {
    uri: vscode.Uri.file(solution),
    fileName: solution,
    languageId: "python",
    getText: () => fs.readFileSync(solution, "utf8"),
    save: async () => true,
    lineAt: () => ({ text: "" }),
    lineCount: 2,
    positionAt: () => new vscode.Position(0, 0),
  };
  vscode.window.activeTextEditor = {
    document: doc,
    selection: { active: new vscode.Position(0, 0), isEmpty: true,
                 start: new vscode.Position(0, 0), end: new vscode.Position(0, 0) },
    edit: async () => true,
    revealRange() {},
    insertSnippet: async () => true,
    setDecorations() {},
  } as any;

  vscode.recorded.answers.set("inputBoxByPrompt", [
    [/course|کلاس/i, "28710"],
    [/assignment|chapter|تمرین|فصل/i, "105409"],
    [/lesson|درسنامه/i, "349153"],
    [/contest|مسابقه/i, "105884"],
    [/submission|ارسال/i, "24461629"],
    [/college|کالج/i, "28258"],
    [/count|how many|تعداد/i, "5"],
    [/seed/i, "1"],
    [/.*/, "3537"],
  ]);
  vscode.recorded.answers.set("quickPick", undefined);
  vscode.recorded.answers.set("openDialog", undefined);
  vscode.recorded.answers.set("saveDialog", undefined);

  const all = [...vscode.commands._registry.keys()].sort();
  console.log(`sweeping ${all.length} commands…\n`);

  for (const command of all) {
    if (SELF_DESTRUCTIVE.has(command)) {
      rows.push({ command, outcome: "skipped", detail: "would sign the harness out" });
      console.log(`  [skip] ${command} — would sign the harness out`);
      continue;
    }
    vscode.recorded.error.length = 0;
    vscode.recorded.warn.length = 0;
    const before = vscode.recorded.panels.length + vscode.recorded.documents.length;
    let outcome = "ok";
    let detail = "";
    try {
      const result = vscode.commands.executeCommand(command);
      await Promise.race([
        result,
        new Promise((_r, reject) =>
          setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)),
      ]);
      const produced = vscode.recorded.panels.length + vscode.recorded.documents.length > before;
      if (vscode.recorded.error.length) {
        outcome = "ERROR-DIALOG";
        detail = vscode.recorded.error[0];
      } else if (!produced && !MUTATING.has(command)) {
        outcome = "no-output";
        detail = vscode.recorded.warn[0] || "produced no panel/document";
      }
    } catch (e: any) {
      outcome = "THREW";
      detail = String(e?.message || e);
    }
    rows.push({ command, outcome, detail: detail.slice(0, 180) });
    const mark = outcome === "ok" ? "ok  " : outcome === "no-output" ? "----" : "FAIL";
    console.log(`  [${mark}] ${command}${detail ? ` — ${detail.slice(0, 110)}` : ""}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  const aiUnconfigured = (r: { command: string; detail: string }) =>
    r.command.startsWith("queracode.ai.") &&
    /no api key|needs an AI provider key|AI provider returned HTTP 40/i.test(r.detail);
  const skipped = rows.filter((r) => (r.outcome === "THREW" || r.outcome === "ERROR-DIALOG") && aiUnconfigured(r));
  const broken = rows.filter(
    (r) => (r.outcome === "THREW" || r.outcome === "ERROR-DIALOG") && !aiUnconfigured(r));
  const quiet = rows.filter((r) => r.outcome === "no-output");
  console.log(`\n=== ${rows.length - broken.length}/${rows.length} commands ran without failing ===`);
  if (broken.length) {
    console.log(`\nBROKEN (${broken.length}):`);
    for (const r of broken) console.log(`  ${r.command}\n      ${r.detail}`);
  }
  if (skipped.length) {
    console.log(`\nSKIPPED (${skipped.length}) — no AI provider key configured, which is the expected refusal:`);
    for (const r of skipped) console.log(`  ${r.command}`);
  }
  if (quiet.length) {
    console.log(`\nNO OUTPUT (${quiet.length}) — may be legitimate (needs a selection/argument):`);
    for (const r of quiet) console.log(`  ${r.command} — ${r.detail}`);
  }
  fs.writeFileSync(`${WORKDIR}/report.json`, JSON.stringify(rows, null, 2));
  return broken.length ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error("HARNESS THREW:", e);
  process.exit(1);
});
