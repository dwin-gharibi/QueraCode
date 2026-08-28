import * as vscode from "vscode";
import * as path from "path";
import { getSettings, problemUrl, queraOrigin, submissionAllowed, writeAllowed } from "./config";
import {
  CATEGORIES, DIFFICULTIES, LANGUAGES, MACROS, ORDERINGS, PROBLEM_TYPES,
  SOLVED_STATES, langByKey, outcomeOf, resolveFileTypeId,
} from "./constants";
import { QueraService } from "./service";
import { ProblemsetProvider } from "./tree/problemsetProvider";
import { CoursesProvider } from "./tree/coursesProvider";
import { SubmissionsProvider } from "./tree/submissionsProvider";
import { showFindings, showLoading, showPreview, showProblem, showResult } from "./panels/show";
import { openDashboard } from "./panels/dashboard";
import { faDateTime, faNum, faPercent } from "./panels/render";
import { listVersions, restoreVersion, snapshotFile } from "./versioning";
import { ACCORDION_SNIPPET, codeBlockSnippet, LIMITS_SNIPPET, SAMPLE_TEST_SNIPPET } from "./codelens";
import { parseProblemUrl } from "./api/queraClient";
import { extractPk, idsFrom, isProblemDetail } from "./args";
import { scaffold, CP_TEMPLATES, LESSON_SKELETON, PROBLEM_SKELETON } from "./snippets";
import { extractSamples } from "./samples";
import { runSample } from "./sandbox";
import {
  checkTestNames, diffOutputs, lintMarkdown, normalizePersian, validateTesterConfig,
} from "./validation";
import { registerMcpServer } from "./agent";
import type { ProblemDetail } from "./api/types";
import { AiClient, ChatMessage, extractCodeBlock } from "./ai/aiClient";
import { PROVIDERS, resolveEnvApiKey, resolveProvider } from "./ai/providers";
import {
  FileEntry, INPUT_KINDS, InputKind, TESTER_CPP_TEMPLATE, TestCase,
  buildTestBundle, generateInputs, validateBundle, zipStore,
} from "./testkit";
import { JUDGE_KINDS, extractTestNames, generateTesterConfig, generateValidFiles } from "./judgekit";
import { openLibraryItem } from "./tree/libraryProvider";
import {
  SubmitPlan, allowedLanguagesLabel, explainError, languageForFile, parseJudgeResult, submitTarget,
} from "./submit";
export { allowedLanguagesLabel, explainError, languageForFile, submitTarget };
import {
  SYNC_CONFIG, SyncConfig, addChapter, buildSyncConfig, cloneRepo, collectLessons, commitAndPush,
  createLesson, deleteLessonFolder, findSyncRepo, initRepo, isGitRepo, pullRepo, readSyncConfig,
  renameLessonFolder, repoStatus, writeSyncConfig, DEFAULT_LESSON_FILE,
} from "./repo";
import { repoSyncSettings } from "./repoSync";
import { Binding, getBinding, removeBinding, setBinding } from "./binding";
import { bindingRoot, DirectSync } from "./directSync";

interface Providers {
  problemset: ProblemsetProvider;
  courses: CoursesProvider;
  submissions: SubmissionsProvider;
}

interface SolutionCtx {
  pk: number;
  aid: number | null;
  type: string;
  lang: string;
  allowed?: { id: number; label: string; extension?: string }[];
  area?: "course" | "contest";
}
const solutionMap = new Map<string, SolutionCtx>();
const lessonEditMap = new Map<string, { chapter: number; lesson: number }>();
export interface AssignmentEditTarget {
  aid: number;
  area: "course" | "college" | "contest";
  problemId: number;
  name: string;
}

class AssignmentEditRegistry {
  private static readonly KEY = "queracode.assignmentEdits";
  private memory = new Map<string, AssignmentEditTarget>();
  private state?: vscode.Memento;

  attach(state: vscode.Memento): void {
    this.state = state;
    for (const [k, v] of Object.entries(state.get<Record<string, AssignmentEditTarget>>(AssignmentEditRegistry.KEY, {}))) {
      this.memory.set(k, v);
    }
  }

  get(fsPath: string): AssignmentEditTarget | undefined {
    return this.memory.get(fsPath);
  }

  set(fsPath: string, target: AssignmentEditTarget): void {
    this.memory.set(fsPath, target);
    void this.state?.update(AssignmentEditRegistry.KEY, Object.fromEntries(this.memory));
  }

  delete(fsPath: string): void {
    this.memory.delete(fsPath);
    void this.state?.update(AssignmentEditRegistry.KEY, Object.fromEntries(this.memory));
  }
}

const assignmentEditMap = new AssignmentEditRegistry();

export function assignmentTargetFor(fsPath: string): AssignmentEditTarget | undefined {
  return assignmentEditMap.get(fsPath);
}

let lenses: { refresh(): void } = { refresh() {} };

export function setLensProvider(provider: { refresh(): void }): void {
  lenses = provider;
}

function resolveLiveFileTypeId(ctx: SolutionCtx): number | undefined {
  const info = langByKey(ctx.lang);
  const ext = info?.ext;
  if (ctx.allowed?.length) {
    const hit = ctx.allowed.find((a) => {
      const label = (a.label || "").toLowerCase();
      const aext = a.extension ? (a.extension.startsWith(".") ? a.extension : "." + a.extension) : "";
      return (ext && aext === ext) || label === ctx.lang || label.includes(ctx.lang);
    });
    return hit?.id;
  }
  return resolveFileTypeId(ctx.type, ctx.lang);
}

async function solutionsRoot(sub: string): Promise<vscode.Uri> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    const pick = await vscode.window.showWarningMessage(
      "QueraCode writes problems, solutions and tests into a workspace folder, and none is open.",
      { modal: true },
      "Open Folder…"
    );
    if (pick === "Open Folder…") {
      await vscode.commands.executeCommand("workbench.action.files.openFolder");
    }
    throw new Error("No workspace folder is open, so QueraCode had nowhere to write.");
  }
  const dir = vscode.Uri.joinPath(folder.uri, getSettings().solutionsDir, sub);
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}


async function writeFileInto(uri: vscode.Uri, data: Uint8Array | Buffer): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
  await vscode.workspace.fs.writeFile(uri, data instanceof Buffer ? new Uint8Array(data) : data);
}

export function registerCommands(context: vscode.ExtensionContext, service: QueraService, providers: Providers): void {
  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  const announceSubmission = async (
    name: string,
    problemId: number,
    opts: { aid?: number | null; area?: "course" | "contest" | "problemset" } = {}
  ): Promise<void> => {
    const done = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification,
        title: `Submitted «${name}» — waiting for the judge…`, cancellable: true },
      async (_p, token) => {
        const client = await service.getClient();
        for (let i = 0; i < 24 && !token.isCancellationRequested; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            let latest: any;
            if (opts.area && opts.area !== "problemset" && opts.aid) {
              const rows = await client.getAssignmentSubmissions(
                opts.aid, opts.area === "contest" ? "contest" : "course", problemId);
              latest = rows[0];
            } else {
              const fresh = await client.getProblem(problemId, "submissions");
              latest = fresh.submissions?.items?.[0];
              if (latest && latest.state !== "J") latest = undefined;
            }
            if (latest) {
              const outcome = outcomeOf(latest);
              if (!outcome.pending) return { outcome, pk: latest.pk };
            }
          } catch { /* keep polling; a transient read must not lose the result */ }
        }
        return undefined;
      });
    providers.submissions.refresh?.();
    if (!done) {
      const go = await vscode.window.showInformationMessage(
        `Submitted «${name}». The judge has not reported yet.`, "Open My Submissions");
      if (go) await vscode.commands.executeCommand("queracode.refresh");
      return;
    }
    const full = done.outcome.accepted;
    const scoreText = done.outcome.score !== undefined ? ` — ${faPercent(done.outcome.score)}` : "";
    const text = `«${name}»: ${done.outcome.fa}${scoreText} · ارسال #${faNum(done.pk)}`;
    if (done.pk) {
      await vscode.commands.executeCommand("queracode.viewSubmissionResult", Number(done.pk))
        .then(undefined, () => undefined);
    }
    if (full) vscode.window.showInformationMessage(`✅ ${text}`);
    else vscode.window.showWarningMessage(`⚠️ ${text}`);
  };

  const offerEnable = async (setting: "enableSubmission" | "enableWrite", why: string): Promise<boolean> => {
    const pick = await vscode.window.showWarningMessage(
      `${why} ('queracode.${setting}' is off — it defaults to off so nothing is sent by accident).`,
      "Enable now", "Cancel");
    if (pick !== "Enable now") return false;
    await vscode.workspace.getConfiguration("queracode").update(setting, true, vscode.ConfigurationTarget.Global);
    if (getSettings().readOnly) {
      await vscode.workspace.getConfiguration("queracode").update("readOnly", false, vscode.ConfigurationTarget.Global);
    }
    return true;
  };

  const refreshAll = () => {
    providers.problemset.refresh();
    providers.courses.refresh();
    providers.submissions.refresh();
    service.fire();
  };

  const announceUser = async () => {
    try {
      const user = await (await service.getClient()).whoami();
      if (user?.is_authenticated === false || !user?.username) {
        vscode.window.showWarningMessage(
          "Credentials stored, but Quera did not report a signed-in user. " +
            "The session may already be expired — try 'Quera: Who Am I'."
        );
      } else {
        vscode.window.showInformationMessage(`Signed in to Quera as ${user.username}.`);
      }
    } catch (e: any) {
      vscode.window.showWarningMessage(`Credentials stored, but verification failed: ${e?.message || e}`);
    }
  };

  reg("queracode.login", async () => {
    const s = getSettings();
    const CREDENTIALS = "credentials";
    const SESSION = "session";
    const picked = await vscode.window.showQuickPick(
      [
        {
          id: CREDENTIALS,
          label: "$(account) Username and password",
          detail: "Your Quera email or mobile number and password. Stored in VS Code's SecretStorage.",
        },
        {
          id: SESSION,
          label: "$(key) Paste a session_id cookie",
          detail: "For accounts that sign in with a one-time code, Google, or GitHub.",
        },
      ],
      {
        title: "Sign in to Quera",
        placeHolder: "How would you like to sign in?",
        matchOnDetail: true,
        ignoreFocusOut: true,
      }
    );
    if (!picked) return;

    if (picked.id === SESSION) {
      const session = await vscode.window.showInputBox({
        title: "Quera session_id",
        prompt: "Paste the session_id cookie from quera.org (DevTools → Application → Cookies).",
        password: true, ignoreFocusOut: true,
      });
      if (!session?.trim()) return;
      await service.secrets.setSession(session.trim());
      const csrf = await vscode.window.showInputBox({
        title: "CSRF token (optional)",
        prompt: "Leave blank — QueraCode fetches one when a request needs it.",
        password: true, ignoreFocusOut: true,
      });
      if (csrf?.trim()) await service.secrets.setCsrf(csrf.trim());
      await vscode.workspace.getConfiguration("queracode")
        .update("authMethod", "sessionId", vscode.ConfigurationTarget.Global);
      service.fire();
      await announceUser();
      refreshAll();
      return;
    }

    const username = await vscode.window.showInputBox({
      title: "Quera sign-in (1 of 2)",
      prompt: "Email address or mobile number of your Quera account",
      value: s.username, ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : "Enter the email or mobile number you sign in with."),
    });
    if (!username?.trim()) return;
    const password = await vscode.window.showInputBox({
      title: "Quera sign-in (2 of 2)",
      prompt: `Password for ${username.trim()} — stored in SecretStorage, never in settings.json`,
      password: true, ignoreFocusOut: true,
      validateInput: (v) => (v ? undefined : "Enter your password."),
    });
    if (!password) return;

    await vscode.workspace.getConfiguration("queracode")
      .update("username", username.trim(), vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration("queracode")
      .update("authMethod", "usernamePassword", vscode.ConfigurationTarget.Global);
    await service.secrets.setPassword(password);
    await service.secrets.deleteSession();
    service.fire();

    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Signing in to Quera…" },
        async () => {
          const client = await service.getClient();
          await client.login();
          await service.captureSession(client);
        }
      );
      service.fire();
      await announceUser();
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "sign in"));
    }
    refreshAll();
  });

  reg("queracode.logout", async () => {
    await service.secrets.clear();
    vscode.window.showInformationMessage("Signed out of Quera.");
    refreshAll();
  });

  reg("queracode.whoami", async () => {
    if (!(await service.isSignedIn())) {
      const go = await vscode.window.showWarningMessage(
        "QueraCode has no stored Quera credentials.", "Sign In");
      if (go) await vscode.commands.executeCommand("queracode.login");
      return;
    }
    try {
      const user = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "Quera: checking session…" },
        async () => (await service.getClient()).whoami()
      );
      if (user?.is_authenticated === false || !user?.username) {
        const go = await vscode.window.showWarningMessage(
          "Quera does not recognise the stored session — it has probably expired.", "Sign In");
        if (go) await vscode.commands.executeCommand("queracode.login");
        return;
      }
      const name = [user.full_name, user.email].filter(Boolean).join(" · ");
      vscode.window.showInformationMessage(
        `Signed in to Quera as ${user.username}${name ? ` (${name})` : ""}.`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "whoami"));
    }
  });

  reg("queracode.refresh", refreshAll);

  reg("queracode.setFilters", async () => {
    const pick = async (title: string, opts: string[], canMany: boolean) =>
      vscode.window.showQuickPick(opts, { title, canPickMany: canMany, ignoreFocusOut: true });
    const diff = await pick("Difficulty (multi)", DIFFICULTIES.map((d) => d.filter), true) as string[] | undefined;
    const order = await pick("Order", ORDERINGS, false) as string | undefined;
    const type = await pick("Problem type (multi)", PROBLEM_TYPES.map((t) => t.code), true) as string[] | undefined;
    const solved = await pick("Solve status (multi)", SOLVED_STATES, true) as string[] | undefined;
    const category = await pick("Category (multi)", CATEGORIES, true) as string[] | undefined;
    const tagStr = await vscode.window.showInputBox({ prompt: "Tags (comma-separated names or ids)", ignoreFocusOut: true });
    providers.problemset.setFilters({
      difficulty: diff, order, type, solved, category,
      tag: tagStr ? tagStr.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      page: 1,
    });
  });

  reg("queracode.clearFilters", () => providers.problemset.clearFilters());

  reg("queracode.searchProblems", async () => {
    const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { pk?: number }>();
    qp.title = "جستجوی تمرین‌های کوئرا";
    qp.placeholder = "نام تمرین را بنویسید — یا یک شناسه/لینک بچسبانید";
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    (qp as any).ignoreFocusOut = true;

    let seq = 0;
    let timer: NodeJS.Timeout | undefined;
    const search = (text: string) => {
      const mine = ++seq;
      qp.busy = true;
      void (async () => {
        try {
          const direct = parseProblemUrl(text.trim())?.problemId
            ?? (/^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined);
          const client = await service.getClient();
          const page = await client.listProblems(direct ? {} : { search: text }, 1);
          if (mine !== seq) return;
          const items: (vscode.QuickPickItem & { pk?: number })[] = [];
          if (direct) {
            items.push({ label: `$(link-external) بازکردن تمرین #${direct}`, pk: direct, alwaysShow: true });
          }
          for (const p of page.items.slice(0, 30)) {
            const diff = DIFFICULTIES.find((d) => d.code === p.difficulty);
            items.push({
              label: p.name || `#${p.pk}`,
              description: `#${p.pk}${diff ? ` · ${diff.fa}` : ""}`,
              detail: (p.tags || []).map((t: any) => `#${t.name}`).join("  ") || undefined,
              pk: Number(p.pk),
            });
          }
          if (!items.length) {
            items.push({ label: "$(info) نتیجه‌ای پیدا نشد", alwaysShow: true });
          }
          qp.items = items;
        } catch (e: any) {
          if (mine === seq) qp.items = [{ label: `$(error) ${explainError(e, "Search")}`, alwaysShow: true }];
        } finally {
          if (mine === seq) qp.busy = false;
        }
      })();
    };

    qp.onDidChangeValue((v) => {
      if (timer) clearTimeout(timer);
      if (!v.trim()) { qp.items = []; return; }
      timer = setTimeout(() => search(v), 280);
    });
    qp.onDidAccept(() => {
      const picked = qp.selectedItems[0];
      if (picked?.pk) {
        void vscode.commands.executeCommand("queracode.openProblem", picked.pk);
        qp.hide();
      } else if (qp.value.trim()) {
        providers.problemset.setFilters({ search: qp.value.trim(), page: 1 });
        qp.hide();
      }
    });
    qp.onDidHide(() => { if (timer) clearTimeout(timer); qp.dispose(); });
    qp.show();
  });

  const fetchProblem = async (pk: number, tab?: string): Promise<ProblemDetail> =>
    (await service.getClient()).getProblem(pk, tab);

  const resolveProblemId = async (
    arg: unknown,
    purpose: string
  ): Promise<number | undefined> => {
    const direct = extractPk(arg);
    if (direct !== undefined) return direct;
    const typed = await vscode.window.showInputBox({
      title: purpose,
      prompt: "Problem id or a quera.org problem URL",
      ignoreFocusOut: true,
      validateInput: (v) => {
        const t = v.trim();
        if (!t) return "Enter a problem id or a Quera URL";
        return parseProblemUrl(t) || /^\d+$/.test(t)
          ? undefined : "Not a problem id or a recognizable Quera URL";
      },
    });
    if (!typed) return undefined;
    const pk = parseProblemUrl(typed.trim())?.problemId ?? Number(typed.trim());
    return Number.isFinite(pk) && pk > 0 ? pk : undefined;
  };

  reg("queracode.openProblem", async (arg: number | ProblemDetail) => {
    const pk = await resolveProblemId(arg, "Open a Quera problem");
    if (!pk) return;
    const panel = showLoading("queracode.problem", `Problem ${pk}`);
    try {
      const problem = await fetchProblem(pk, "submissions");
      showProblem(problem, panel);
      if (problem.submissions?.items?.length) {
        providers.submissions.set(problem.name || `#${pk}`, problem.submissions.items);
      }
    } catch (e: any) {
      panel.dispose();
      vscode.window.showErrorMessage(explainError(e, "Open problem"));
    }
  });

  reg("queracode.solveProblem", async (arg: number | ProblemDetail) => {
    let problem: ProblemDetail | undefined;
    if (isProblemDetail(arg)) problem = arg as ProblemDetail;
    else {
      const pk = await resolveProblemId(arg, "Which problem?");
      if (pk === undefined) return;
      problem = await fetchProblem(pk);
    }
    if (!problem?.pk) return;
    const langKey = await vscode.window.showQuickPick(
      LANGUAGES.map((l) => ({ label: l.label, description: l.key })),
      { title: "Language for your solution", ignoreFocusOut: true });
    if (!langKey) return;
    const info = langByKey(langKey.description!)!;
    const dir = await solutionsRoot(`problem-${problem.pk}`);
    const fileName = (info.key === "java" ? "Main" : "solution") + info.ext;
    const file = vscode.Uri.joinPath(dir, fileName);
    try {
      await vscode.workspace.fs.stat(file);
    } catch {
      await vscode.workspace.fs.writeFile(file, Buffer.from(scaffold(info.key, problem.name)));
    }
    solutionMap.set(file.fsPath, {
      pk: problem.pk,
      aid: problem.assignment?.pk ?? null,
      type: problem.type || "J",
      lang: info.key,
      allowed: problem.allowed_file_types,
    });
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc);
    vscode.commands.executeCommand("setContext", "queracode.canSubmit", true);
    if (problem.description) {
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, "statement.md"), Buffer.from(`# ${problem.name || "مسئله " + problem.pk}\n\n${problem.description}`));
    }
  });

  reg("queracode.downloadInitProject", async (arg: number | ProblemDetail) => {
    let problem: ProblemDetail | undefined;
    if (isProblemDetail(arg)) problem = arg as ProblemDetail;
    else {
      const pk = await resolveProblemId(arg, "Which problem?");
      if (pk === undefined) return;
      problem = await fetchProblem(pk);
    }
    const tgt = submitTarget(problem);
    const aid = tgt.area === "problemset" ? undefined : tgt.aid;
    if (!aid || !problem?.pk) {
      vscode.window.showWarningMessage(
        tgt.area === "problemset"
          ? "Problemset problems have no initial project — that is only for course and contest assignments."
          : "This problem has no downloadable initial project (missing assignment id).");
      return;
    }
    try {
      const client = await service.getClient();
      const result = await client.download(`${tgt.area}/assignments/${aid}/download_problem_initial_project/${problem.pk}/`);
      const dir = await solutionsRoot(`problem-${problem.pk}`);
      const target = vscode.Uri.joinPath(dir, result.filename);
      await vscode.workspace.fs.writeFile(target, result.bytes);
      vscode.window.showInformationMessage(`Downloaded ${result.filename} (${result.bytes.length} bytes) → ${path.basename(target.fsPath)}`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Download"));
    }
  });

  const resolveSolutionEditor = async (pk?: number): Promise<vscode.TextEditor | undefined> => {
    const linkedTo = (e: vscode.TextEditor) => solutionMap.get(e.document.uri.fsPath);
    const active = vscode.window.activeTextEditor;
    if (active && (!pk || linkedTo(active)?.pk === pk)) return active;
    const visible = vscode.window.visibleTextEditors.find((e) => {
      const c = linkedTo(e);
      return c && (!pk || c.pk === pk);
    });
    if (visible) return vscode.window.showTextDocument(visible.document, visible.viewColumn, false);
    const entry = [...solutionMap.entries()].find(([, c]) => !pk || c.pk === pk);
    if (entry) {
      try {
        return await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument(vscode.Uri.file(entry[0])));
      } catch { /* file may have been deleted — keep looking */ }
    }
    if (pk) {
      const found = await vscode.workspace.findFiles(
        `**/problem-${pk}/**/*.{py,cpp,c,java,js,ts,go,rs,kt,php,rb,cs}`, "**/node_modules/**", 6);
      if (found.length) {
        const pick = found.length === 1
          ? { f: found[0] }
          : await vscode.window.showQuickPick(
              found.map((f) => ({ label: path.basename(f.fsPath), description: f.fsPath, f })),
              { title: "کدام فایل راه‌حل؟ · Which solution file?" });
        if (pick?.f) return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(pick.f));
      }
    }
    return active;
  };

  const offerSolutionScaffold = async (
    problem?: ProblemDetail | number
  ): Promise<vscode.TextEditor | undefined> => {
    const pick = await vscode.window.showWarningMessage(
      "No solution file is open for this problem yet.",
      "Create solution", "Open a file…"
    );
    if (pick === "Create solution") {
      if (problem !== undefined) await vscode.commands.executeCommand("queracode.solveProblem", problem);
      else await vscode.commands.executeCommand("queracode.solveProblem");
      return vscode.window.activeTextEditor;
    }
    if (pick === "Open a file…") {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false, openLabel: "Use this file",
        title: "Pick the solution file to use",
      });
      if (picked?.[0]) {
        return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(picked[0]));
      }
    }
    return undefined;
  };

  reg("queracode.runSamples", async (arg: number | ProblemDetail) => {
    let problem: ProblemDetail | undefined;
    if (isProblemDetail(arg)) problem = arg as ProblemDetail;
    else {
      const pk = await resolveProblemId(arg, "Which problem?");
      if (pk === undefined) return;
      problem = await fetchProblem(pk);
    }
    const editor = await resolveSolutionEditor(problem?.pk ? Number(problem.pk) : undefined);
    const ctx = editor ? solutionMap.get(editor.document.uri.fsPath) : undefined;
    const lang = ctx?.lang || getSettings().defaultLanguage;
    if (!editor) {
      const made = await offerSolutionScaffold(problem ?? undefined);
      if (made) await vscode.commands.executeCommand("queracode.runSamples", arg);
      return;
      return;
    }
    await editor.document.save();
    const samples = extractSamples(problem?.description || "");
    const runnable = samples.filter((s) => s.input !== null);
    try {
      const testsDir = vscode.Uri.joinPath(vscode.Uri.file(path.dirname(editor.document.uri.fsPath)), "tests");
      for (const [name, kind] of await vscode.workspace.fs.readDirectory(testsDir)) {
        if (kind !== vscode.FileType.File || !name.endsWith(".in")) continue;
        const input = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(testsDir, name))).toString();
        let output: string | null = null;
        try {
          output = Buffer.from(await vscode.workspace.fs.readFile(
            vscode.Uri.joinPath(testsDir, name.replace(/\.in$/, ".out")))).toString();
        } catch { /* expected-output file is optional */ }
        runnable.push({ input, output, source: `custom:${name}` } as any);
      }
    } catch { /* no tests/ folder — statement samples only */ }
    if (!runnable.length) {
      vscode.window.showInformationMessage(
        "No runnable samples found (only macro references). Add your own with 'Quera: Add Custom Test'.");
      return;
    }
    const mode = getSettings().sandbox;
    const results: { status: any; result?: any }[] = [];
    for (const [i, sample] of runnable.entries()) {
      const out = await runSample(lang, editor.document.uri.fsPath, sample.input || "", mode);
      if (out.skipped) {
        vscode.window.showInformationMessage(`Sample runner is off. Command:\n${out.command}`);
        return;
      }
      const cmp = diffOutputs(sample.output || "", out.stdout);
      results.push({ status: cmp.match ? "PASS" : out.timedOut ? "TLE" : "WA", result: cmp.match ? "" : `L${cmp.line}: expected «${cmp.expected}» got «${cmp.actual}»` });
    }
    const passed = results.filter((r) => r.status === "PASS").length;
    showResult(`Samples: ${passed}/${results.length} passed`, passed === results.length ? "AC" : "WA", passed, results);
  });

  reg("queracode.submitSolution", async () => {
    const editor = await resolveSolutionEditor();
    if (!editor) {
      const made = await offerSolutionScaffold();
      if (made) await vscode.commands.executeCommand("queracode.submitSolution");
      return;
    }
    const ctx = solutionMap.get(editor.document.uri.fsPath);
    if (!ctx || !ctx.aid) {
      vscode.window.showWarningMessage("This file isn't linked to a Quera problem (use 'Solve Problem' first), or the problem has no assignment.");
      return;
    }
    const s = getSettings();
    if (!submissionAllowed(s)) {
      if (!(await offerEnable("enableSubmission", "Submitting to Quera is currently disabled"))) return;
    }
    const fileTypeId = resolveLiveFileTypeId(ctx);
    if (fileTypeId === undefined) {
      vscode.window.showErrorMessage(
        `Problem #${ctx.pk} does not accept ${ctx.lang}. ` +
        `Accepted: ${allowedLanguagesLabel(ctx.allowed)}.`);
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Submit ${path.basename(editor.document.uri.fsPath)} to Quera problem #${ctx.pk} (file_type ${fileTypeId})? This consumes an attempt.`,
      { modal: true }, "Submit");
    if (confirm !== "Submit") return;
    await editor.document.save();
    try {
      await snapshotFile(editor.document.uri, `submit-p${ctx.pk}`).catch(() => undefined);
      const client = await service.getClient();
      const tgt = submitTarget({ assignment: ctx.aid ? { pk: ctx.aid } : null, area: ctx.area });
      const res = await client.submitFile(tgt.aid, ctx.pk, path.basename(editor.document.uri.fsPath), editor.document.getText(), fileTypeId, tgt.area);
      await announceSubmission(`#${ctx.pk}`, ctx.pk, { aid: tgt.aid, area: tgt.area });
      const problem = await fetchProblem(ctx.pk, "submissions");
      if (problem.submissions?.items) providers.submissions.set(problem.name || `#${ctx.pk}`, problem.submissions.items);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Submit"));
    }
  });

  reg("queracode.viewSubmissionResult", async (arg: any) => {
    let pk = (idsFrom(arg, [], ["pk"])[0] ?? Number(arg)) as number;
    if (!Number.isFinite(pk) || pk <= 0) {
      const typed = await vscode.window.showInputBox({
        title: "View a submission's judge result",
        prompt: "Submission id (find it in 'My Submissions')",
        ignoreFocusOut: true,
        validateInput: (v) => (/^\d+$/.test(v.trim()) ? undefined : "Enter a numeric submission id"),
      });
      if (!typed) return;
      pk = Number(typed.trim());
    }
    try {
      const client = await service.getClient();
      const result = await client.postAction("assignment/submission_action", { action: "get_result", submission_id: pk });
      const judge = parseJudgeResult(result?.result);
      const tests = result?.tests || result?.results || result?.testcases || [];
      showResult(`Submission #${pk}`,
        result?.short_judge_result || result?.verdict || judge.verdict,
        result?.score, tests, judge);
    } catch (e: any) {
      const msg = /HTTP 5\d\d/.test(String(e?.message))
        ? `Quera could not return the result for submission #${pk} — its problem may have been deleted or rejudged. (${e?.message})`
        : `Result fetch failed: ${e?.message || e}`;
      vscode.window.showErrorMessage(msg);
    }
  });
  reg("queracode.openCourse", async () => {
    const idStr = await vscode.window.showInputBox({ prompt: "Course id", ignoreFocusOut: true });
    if (!idStr) return;
    try {
      const course = await (await service.getClient()).getCourse(Number(idStr));
      showPreview(course.name || `Course ${idStr}`,
        `# ${course.name}\n\nInstructor: ${course.instructor_name || "?"}\n\n## Assignments\n\n` +
        (course.assignments || []).map((a) => `- **${a.name}** (${a.state || "?"})`).join("\n"));
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Open course"));
    }
  });

  reg("queracode.openLesson", async (arg: number | { chapterId?: number }) => {
    const assignmentId = typeof arg === "number" ? arg : arg?.chapterId;
    let id = assignmentId;
    if (!id) {
      const idStr = await vscode.window.showInputBox({ prompt: "Chapter (assignment) id", ignoreFocusOut: true });
      if (!idStr) return;
      id = Number(idStr);
    }
    try {
      const client = await service.getClient();
      const md = await client.getAssignmentProblemsMarkdown(id);
      showPreview(`Assignment ${id}`, md);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Open assignment"));
    }
  });

  reg("queracode.readLesson", async (
    arg: number | { chapterId?: number; lessonId?: number }, lessonArg?: number,
  ) => {
    let chapter = typeof arg === "number" ? arg : arg?.chapterId;
    let lesson = typeof arg === "number" ? lessonArg : arg?.lessonId;
    if (!chapter || !lesson) {
      const c = await vscode.window.showInputBox({ prompt: "Chapter (assignment) id", ignoreFocusOut: true });
      const l = await vscode.window.showInputBox({ prompt: "Lesson (problem) id", ignoreFocusOut: true });
      if (!c || !l) return;
      chapter = Number(c);
      lesson = Number(l);
    }
    try {
      const client = await service.getClient();
      const md = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Loading lesson ${lesson}…` },
        () => client.getCourseProblemMarkdown(chapter!, lesson!));
      const heading = md.match(/^#\s+(.+)$/m)?.[1]?.trim();
      showPreview(heading || `Lesson ${lesson}`, md);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Read lesson"));
    }
  });

  reg("queracode.newLesson", async () => {
    const dir = await solutionsRoot("lessons");
    const file = vscode.Uri.joinPath(dir, `lesson-${Date.now()}.md`);
    await vscode.workspace.fs.writeFile(file, Buffer.from(LESSON_SKELETON));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    vscode.window.showInformationMessage("New lesson skeleton created. Author it, validate, then Publish Lesson (needs a chapter/lesson id + enableWrite).");
  });

  reg("queracode.newProblem", async () => {
    const dir = await solutionsRoot("problems");
    const file = vscode.Uri.joinPath(dir, `problem-${Date.now()}.md`);
    await vscode.workspace.fs.writeFile(file, Buffer.from(PROBLEM_SKELETON));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
  });

  reg("queracode.editLesson", async (arg?: { chapterId?: number; lessonId?: number }) => {
    let chapter = arg?.chapterId ? String(arg.chapterId) : undefined;
    let lesson = arg?.lessonId ? String(arg.lessonId) : undefined;
    if (!chapter || !lesson) {
      chapter = await vscode.window.showInputBox({ prompt: "Chapter (assignment) id", ignoreFocusOut: true });
      lesson = await vscode.window.showInputBox({ prompt: "Lesson (problem) id", ignoreFocusOut: true });
    }
    if (!chapter || !lesson) return;
    try {
      const client = await service.getClient();
      const body = await client.getLessonBody(Number(chapter), Number(lesson));
      if (body === undefined) {
        vscode.window.showWarningMessage("No lesson body found — you may lack college-admin permission on that course.");
        return;
      }
      const dir = await solutionsRoot("lessons");
      const file = vscode.Uri.joinPath(dir, `lesson-${chapter}-${lesson}.md`);
      await vscode.workspace.fs.writeFile(file, Buffer.from(body));
      lessonEditMap.set(file.fsPath, { chapter: Number(chapter), lesson: Number(lesson) });
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
      vscode.window.showInformationMessage("Loaded lesson body. Edit, then run 'Quera: Publish Lesson'.");
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Edit lesson"));
    }
  });

  reg("queracode.publishLesson", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      vscode.window.showWarningMessage("Open the lesson Markdown file first.");
      return;
    }
    if (!writeAllowed(getSettings())) {
      if (!(await offerEnable("enableWrite", "Publishing content to Quera is currently disabled"))) return;
    }
    const findings = lintMarkdown(editor.document.getText());
    if (findings.some((f) => f.severity === "error")) {
      showFindings("Fix these Markdown errors before publishing", findings);
      return;
    }
    let ctx = lessonEditMap.get(editor.document.uri.fsPath);
    if (!ctx) {
      const chapter = await vscode.window.showInputBox({ prompt: "Chapter (assignment) id", ignoreFocusOut: true });
      const lesson = await vscode.window.showInputBox({ prompt: "Lesson (problem) id", ignoreFocusOut: true });
      if (!chapter || !lesson) return;
      ctx = { chapter: Number(chapter), lesson: Number(lesson) };
    }
    const title = await vscode.window.showInputBox({ prompt: "Lesson title (leave blank to keep the current one)", ignoreFocusOut: true });
    const confirm = await vscode.window.showWarningMessage(
      `Publish to Quera lesson #${ctx.lesson} (chapter ${ctx.chapter})? This modifies live course content.`,
      { modal: true }, "Publish");
    if (confirm !== "Publish") return;
    try {
      await snapshotFile(editor.document.uri, `publish-l${ctx.lesson}`).catch(() => undefined);
      const client = await service.getClient();
      const sent = editor.document.getText();
      await client.publishLesson(ctx.chapter, ctx.lesson, {
        name: title || undefined,
        description: sent,
      });
      lessonEditMap.set(editor.document.uri.fsPath, ctx);
      const stored = await client.getLessonBody(ctx.chapter, ctx.lesson).catch(() => undefined);
      vscode.window.showInformationMessage(
        stored === undefined
          ? `Published lesson #${ctx.lesson}, but the saved text could not be re-read to confirm it.`
          : stored.trim() === sent.trim()
            ? `Published lesson #${ctx.lesson} — verified on Quera.`
            : `Quera accepted the request but lesson #${ctx.lesson} still differs from your text. ` +
              `Re-open it and check for a validation error.`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Publish"));
    }
  });

  reg("queracode.previewMarkdown", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    showPreview(path.basename(editor.document.fileName), editor.document.getText(),
      { localRoot: vscode.Uri.joinPath(editor.document.uri, "..") });
  });

  reg("queracode.validateMarkdown", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    showFindings("Markdown validation", lintMarkdown(editor.document.getText()));
  });

  reg("queracode.normalizePersian", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const sel = editor.selection.isEmpty ? undefined : editor.selection;
    const range = sel || new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));
    const out = normalizePersian(editor.document.getText(range));
    if (!out.changed) {
      vscode.window.showInformationMessage("Persian text already normalized.");
      return;
    }
    await editor.edit((e) => e.replace(range, out.text));
    vscode.window.showInformationMessage("Normalized Persian text (ZWNJ, Arabic letters, spacing).");
  });

  reg("queracode.validateJudge", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Open a tester_config.json to validate it.");
      return;
    }
    const name = path.basename(editor.document.uri.fsPath);
    const text = editor.document.getText().trim();
    if (!text.startsWith("{")) {
      vscode.window.showWarningMessage(
        `«${name}» is not a JSON object — open the judge's tester_config.json and run this again.`);
      return;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (e: any) {
      vscode.window.showErrorMessage(`«${name}» is not valid JSON: ${e?.message}`);
      return;
    }
    const v = validateTesterConfig(parsed);
    showFindings(
      `Judge: ${v.valid ? "valid" : "invalid"} (${v.totalScore}/100, ${v.testCount} tests)`,
      v.errors.map((m) => ({ rule: "tester_config", line: 0, severity: "error" as const, message: m })),
      v.warnings);
  });

  reg("queracode.validateTestNames", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const r = checkTestNames(editor.document.getText());
    showFindings(`Test names: ${r.flagged} flagged`,
      r.findings.map((f) => ({ rule: "test-name", line: 0, severity: "warning" as const, message: `${f.name}: ${f.issues.join("; ")}` })));
  });

  reg("queracode.validateDevopsImage", async () => {
    const image = await vscode.window.showInputBox({ prompt: "Docker image (e.g. python:3.12-slim)", ignoreFocusOut: true });
    if (!image) return;
    const known = ["python", "gcc", "node", "golang", "php", "ruby", "rust", "nginx", "redis", "postgres", "mysql", "mongo", "rabbitmq", "minio", "ubuntu", "alpine", "debian", "docker", "kind", "k3d"];
    const repo = image.split("@")[0].split(":")[0].split("/").pop()!.toLowerCase();
    const ok = known.includes(repo);
    vscode.window.showInformationMessage(
      `${image}: ${ok ? "repo is in the qregistry snapshot" : "repo NOT in the local snapshot"}. The live qregistry is authoritative; only whitelisted images & tags are valid.`);
  });

  reg("queracode.insertMacro", async () => {
    const macro = await vscode.window.showQuickPick(MACROS, { title: "Insert a Quera macro" });
    const editor = vscode.window.activeTextEditor;
    if (macro && editor) editor.insertSnippet(new vscode.SnippetString(macro));
  });

  reg("queracode.insertTemplate", async () => {
    const name = await vscode.window.showQuickPick(
      Object.entries(CP_TEMPLATES).map(([k, v]) => ({ label: k, description: v.desc })),
      { title: "Insert a competitive-programming template" });
    if (!name) return;
    const lang = await vscode.window.showQuickPick(["python", "cpp"], { title: "Language" });
    const editor = vscode.window.activeTextEditor;
    if (lang && editor) editor.insertSnippet(new vscode.SnippetString((CP_TEMPLATES as any)[name.label][lang]));
  });

  reg("queracode.registerMcp", async () => registerMcpServer(true));

  reg("queracode.solveWithAgent", async (arg: number | ProblemDetail) => {
    const pk = await resolveProblemId(arg, "Solve with a coder agent");
    if (!pk) return;
    let problem: ProblemDetail;
    try {
      problem = typeof arg === "object" && arg?.description ? arg : await fetchProblem(pk);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Solve with agent"));
      return;
    }
    await registerMcpServer(false);
    const brief = `Solve Quera problem #${problem.pk} "${problem.name}" (difficulty ${problem.difficulty}). ` +
      `Use the QueraMCP tools (quera_solve_problem, quera_submit_solution). Statement:\n\n${problem.description || ""}`;
    await vscode.env.clipboard.writeText(brief);
    vscode.window.showInformationMessage("Copied a solving brief to the clipboard and registered QueraMCP. Paste it into your coder agent (Copilot/Claude).");
  });

  const getAi = async (): Promise<AiClient> => {
    const s = getSettings();
    const provider = resolveProvider(s.aiProvider);
    const stored = await service.secrets.getAiKey();
    return new AiClient({
      provider: provider.name,
      model: s.aiModel || undefined,
      baseUrl: s.aiBaseUrl || undefined,
      apiKey: stored || resolveEnvApiKey(provider),
      appTitle: "QueraCode",
    });
  };

  const runChat = (title: string, ai: AiClient, messages: ChatMessage[]) =>
    vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title },
      () => ai.chat(messages));

  const resolveProblemArg = async (arg?: unknown): Promise<ProblemDetail | undefined> => {
    let pk: number | undefined;
    let detail: ProblemDetail | undefined;
    if (typeof arg === "number") pk = arg;
    else if (arg && typeof arg === "object") {
      const a = arg as any;
      if (typeof a.pk === "number") {
        pk = a.pk;
        if (typeof a.description === "string") detail = a as ProblemDetail;
      } else if (typeof a.problem?.pk === "number") pk = a.problem.pk;
    }
    if (!pk) {
      const editor = vscode.window.activeTextEditor;
      pk = editor ? solutionMap.get(editor.document.uri.fsPath)?.pk : undefined;
    }
    if (!pk) {
      const idStr = await vscode.window.showInputBox({
        prompt: "Quera problem id", ignoreFocusOut: true,
        validateInput: (v) => (/^\d+$/.test(v.trim()) ? undefined : "Enter a numeric problem id"),
      });
      if (!idStr) return undefined;
      pk = Number(idStr.trim());
    }
    if (detail) return detail;
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Loading problem ${pk}…` },
      () => fetchProblem(pk!));
  };

  reg("queracode.ai.configure", async () => {
    const pick = await vscode.window.showQuickPick(
      PROVIDERS.map((p) => ({
        label: p.label,
        description: p.name,
        detail: `${p.api} API · ${p.defaultModel ? `default model: ${p.defaultModel}` : "bring your own model"}` +
          `${p.needsKey ? "" : " · no API key required"}${p.notes ? ` — ${p.notes}` : ""}`,
      })),
      { title: "Quera AI: choose a provider", ignoreFocusOut: true });
    if (!pick) return;
    const provider = resolveProvider(pick.description);
    const cfg = vscode.workspace.getConfiguration("queracode");
    await cfg.update("ai.provider", provider.name, vscode.ConfigurationTarget.Global);
    if (!provider.baseUrl) {
      const baseUrl = await vscode.window.showInputBox({
        prompt: "Base URL of the OpenAI-compatible endpoint (e.g. https://my-gateway.example/v1)",
        value: getSettings().aiBaseUrl, ignoreFocusOut: true,
      });
      if (baseUrl === undefined) return;
      await cfg.update("ai.baseUrl", baseUrl.trim(), vscode.ConfigurationTarget.Global);
    }
    if (provider.needsKey || provider.name === "custom") {
      const key = await vscode.window.showInputBox({
        prompt: `${provider.label} API key — stored in VS Code SecretStorage, never in settings` +
          (provider.needsKey ? "" : " (leave blank if the endpoint needs none)"),
        password: true, ignoreFocusOut: true,
      });
      if (key === undefined) return;
      if (key.trim()) await service.secrets.setAiKey(key.trim());
    }
    const model = await vscode.window.showInputBox({
      prompt: `Model id${provider.defaultModel ? ` (blank = provider default: ${provider.defaultModel})` : ""}`,
      value: getSettings().aiModel, ignoreFocusOut: true,
    });
    if (model !== undefined) await cfg.update("ai.model", model.trim(), vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      `Quera AI configured: ${provider.label} · model ${(model || "").trim() || provider.defaultModel || "(unset)"}. The API key lives in SecretStorage.`);
  });

  reg("queracode.ai.generateSolution", async (arg?: number | ProblemDetail) => {
    try {
      const problem = await resolveProblemArg(arg);
      if (!problem?.pk) return;
      const langPick = await vscode.window.showQuickPick(
        LANGUAGES.map((l) => ({ label: l.label, description: l.key })),
        { title: "Language for the AI solution", ignoreFocusOut: true });
      if (!langPick) return;
      const info = langByKey(langPick.description!)!;
      const ai = await getAi();
      const samplesText = extractSamples(problem.description || "")
        .filter((s) => s.input !== null || s.output !== null)
        .map((s, i) => `Sample ${i + 1}:\nInput:\n${s.input ?? ""}\nExpected output:\n${s.output ?? ""}`)
        .join("\n\n");
      const messages: ChatMessage[] = [
        {
          role: "system",
          content:
            "You are an expert competitive programmer and judge-aware solver for Quera (an online judge). " +
            `Write a correct, efficient, self-contained solution in ${info.key} that reads from standard input ` +
            "and writes to standard output unless the statement says otherwise. Return the code in a single " +
            "fenced code block, then a short explanation of the approach and its time/space complexity.",
        },
        {
          role: "user",
          content:
            `Problem: ${problem.name || `#${problem.pk}`} (difficulty ${problem.difficulty || "?"})\n\n` +
            `Statement (Markdown):\n${problem.description || ""}\n\n` +
            `${samplesText || "No inline samples were found."}`,
        },
      ];
      const reply = await runChat(`Quera AI: drafting a ${info.label} solution for #${problem.pk}…`, ai, messages);
      const preview = () => showPreview(
        `AI solution — ${problem.name || `#${problem.pk}`}`,
        `# AI solution for ${problem.name || `#${problem.pk}`}\n\n` +
        `_${reply.provider} · ${reply.model} — review and test before submitting; nothing was submitted._\n\n${reply.content}`);
      const code = extractCodeBlock(reply.content);
      if (!code) {
        vscode.window.showWarningMessage("The model returned no code.");
        preview();
        return;
      }
      const dir = await solutionsRoot(`problem-${problem.pk}`);
      const fileName = (info.key === "java" ? "Main" : "solution") + info.ext;
      const file = vscode.Uri.joinPath(dir, fileName);
      let exists = true;
      try {
        await vscode.workspace.fs.stat(file);
      } catch {
        exists = false;
      }
      if (exists) {
        const confirm = await vscode.window.showWarningMessage(
          `${fileName} already exists for problem #${problem.pk}. Overwrite it with the AI draft?`,
          { modal: true }, "Overwrite");
        if (confirm !== "Overwrite") {
          preview();
          return;
        }
      }
      await vscode.workspace.fs.writeFile(file, Buffer.from(code.endsWith("\n") ? code : code + "\n"));
      solutionMap.set(file.fsPath, {
        pk: problem.pk,
        aid: problem.assignment?.pk ?? null,
        type: problem.type || "J",
        lang: info.key,
        allowed: problem.allowed_file_types,
      });
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
      vscode.commands.executeCommand("setContext", "queracode.canSubmit", true);
      preview();
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "AI solution"));
    }
  });

  reg("queracode.ai.explainProblem", async (arg?: number | ProblemDetail) => {
    try {
      const problem = await resolveProblemArg(arg);
      if (!problem?.pk) return;
      const ai = await getAi();
      const messages: ChatMessage[] = [
        {
          role: "system",
          content:
            "You are a patient programming tutor. Explain the problem clearly: restate what is being asked, " +
            "describe the key observation or algorithmic idea, note constraints/edge cases, and give one hint. " +
            "Do NOT write the full solution code.",
        },
        { role: "user", content: `${problem.name || `Problem #${problem.pk}`}\n\n${problem.description || ""}` },
      ];
      const reply = await runChat(`Quera AI: explaining #${problem.pk}…`, ai, messages);
      showPreview(
        `AI explanation — ${problem.name || `#${problem.pk}`}`,
        `# ${problem.name || `Problem #${problem.pk}`} — explained\n\n_${reply.provider} · ${reply.model}_\n\n${reply.content}`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "AI explain"));
    }
  });

  reg("queracode.ai.reviewSubmission", async (arg?: number | vscode.TreeItem) => {
    let pk: number | undefined;
    if (typeof arg === "number") pk = arg;
    else if (typeof (arg as any)?.command?.arguments?.[0] === "number") pk = (arg as any).command.arguments[0];
    if (!pk) {
      const idStr = await vscode.window.showInputBox({
        prompt: "Submission id", ignoreFocusOut: true,
        validateInput: (v) => (/^\d+$/.test(v.trim()) ? undefined : "Enter a numeric submission id"),
      });
      if (!idStr) return;
      pk = Number(idStr.trim());
    }
    try {
      const ai = await getAi();
      const client = await service.getClient();
      const [result, log, code] = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Fetching submission #${pk}…` },
        () => Promise.all([
          client.postAction("assignment/submission_action", { action: "get_result", submission_id: pk! }),
          client.postAction("assignment/submission_action", { action: "get_judge_log", submission_id: pk! }).catch(() => undefined),
          client.postAction("assignment/submission_action", { action: "get_code", submission_id: pk! }).catch(() => undefined),
        ]));
      const clip = (v: any) => {
        const s = typeof v === "string" ? v : JSON.stringify(v ?? {}, null, 2);
        return s.length > 8000 ? s.slice(0, 8000) + "\n…[truncated]" : s;
      };
      const messages: ChatMessage[] = [
        {
          role: "system",
          content:
            "You are a debugging expert for competitive-programming judges. Given a verdict, judge log, and " +
            "source code, identify the root cause of the failure (wrong answer, TLE, MLE, runtime/compile error, " +
            "edge case), and give a concrete, minimal fix.",
        },
        {
          role: "user",
          content: `Verdict/result:\n${clip(result)}\n\nJudge log:\n${clip(log)}\n\nSource code:\n${clip(code)}`,
        },
      ];
      const reply = await runChat(`Quera AI: reviewing submission #${pk}…`, ai, messages);
      showPreview(
        `AI review — submission #${pk}`,
        `# Submission #${pk} — AI diagnosis\n\n_${reply.provider} · ${reply.model}_\n\n${reply.content}`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "AI review"));
    }
  });

  reg("queracode.ai.chat", async () => {
    const prompt = await vscode.window.showInputBox({
      prompt: "Ask the AI model anything (Quera, algorithms, your code, …)", ignoreFocusOut: true,
    });
    if (!prompt) return;
    try {
      const ai = await getAi();
      const reply = await runChat("Quera AI: thinking…", ai, [{ role: "user", content: prompt }]);
      showPreview("Quera AI chat", `# Quera AI chat\n\n> ${prompt}\n\n---\n\n${reply.content}\n\n---\n\n_${reply.provider} · ${reply.model}_`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "AI chat"));
    }
  });

  const testsRoot = () => solutionsRoot("tests");

  const writeEntries = async (dir: vscode.Uri, entries: FileEntry[]): Promise<void> => {
    for (const entry of entries) {
      const parts = entry.path.split("/");
      if (parts.length > 1) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(dir, ...parts.slice(0, -1)));
      }
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, ...parts), Buffer.from(entry.content));
    }
  };

  reg("queracode.generateTestInputs", async () => {
    const kindDescriptions: Record<InputKind, string> = {
      single_int: "one integer per test",
      array: "n, then n space-separated integers",
      matrix: "r c, then an r×c integer grid",
      string: "a random lowercase string",
      graph: "n m, then m undirected edges (connected)",
      pairs: "n, then n integer pairs",
    };
    const kindPick = await vscode.window.showQuickPick(
      INPUT_KINDS.map((k) => ({ label: k, description: kindDescriptions[k] })),
      { title: "Kind of test input to generate", ignoreFocusOut: true });
    if (!kindPick) return;
    const countStr = await vscode.window.showInputBox({
      prompt: "How many test inputs? (1–200)", value: "5", ignoreFocusOut: true,
      validateInput: (v) => (/^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 200 ? undefined : "Enter a number between 1 and 200"),
    });
    if (!countStr) return;
    const seedStr = await vscode.window.showInputBox({
      prompt: "Seed (optional — the same seed reproduces the same tests)", ignoreFocusOut: true,
    });
    if (seedStr === undefined) return;
    const spec = await askAdvancedSpec(kindPick.label as InputKind, Number(countStr));
    if (!spec) return;
    let inputs: string[];
    try {
      inputs = generateInputs(spec, seedStr.trim() || undefined);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Generate inputs"));
      return;
    }
    const destPick = await vscode.window.showQuickPick(
      [
        { label: "Write to tests folder", description: `${getSettings().solutionsDir}/tests/in/inputN.txt — ready for 'Build Test Bundle'` },
        { label: "Preview only", description: "show the inputs in a panel without writing files" },
      ],
      { title: "Where should the inputs go?", ignoreFocusOut: true });
    if (!destPick) return;
    if (destPick.label === "Preview only") {
      showPreview(
        `Generated ${kindPick.label} inputs`,
        inputs.map((s, i) => `## input${i + 1}.txt\n\n\`\`\`text\n${s}\`\`\``).join("\n\n"));
      return;
    }
    try {
      const dir = await testsRoot();
      await writeEntries(dir, inputs.map((content, i) => ({ path: `in/input${i + 1}.txt`, content })));
      vscode.window.showInformationMessage(
        `Wrote ${inputs.length} inputs to ${path.join(dir.fsPath, "in")}. Add matching out/outputN.txt files ` +
        "(run your reference solution) or a tester.cpp, then run 'Quera: Build Test Bundle'.");
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Write inputs"));
    }
  });

  reg("queracode.buildTestBundle", async () => {
    try {
      const dir = await testsRoot();
      const readNumbered = async (sub: "in" | "out"): Promise<Map<number, string>> => {
        const map = new Map<number, string>();
        const subUri = vscode.Uri.joinPath(dir, sub);
        let listing: [string, vscode.FileType][];
        try {
          listing = await vscode.workspace.fs.readDirectory(subUri);
        } catch {
          return map;
        }
        const re = new RegExp(`^${sub === "in" ? "input" : "output"}(\\d+)\\.txt$`, "i");
        for (const [name, type] of listing) {
          const m = re.exec(name);
          if (type === vscode.FileType.File && m) {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(subUri, name));
            map.set(Number(m[1]), Buffer.from(bytes).toString("utf8"));
          }
        }
        return map;
      };
      const ins = await readNumbered("in");
      const outs = await readNumbered("out");
      if (!ins.size) {
        vscode.window.showWarningMessage(
          `No inputN.txt files in ${path.join(dir.fsPath, "in")}. Run 'Quera: Generate Test Inputs' first (or add them manually).`);
        return;
      }
      let tester: string | undefined;
      try {
        tester = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, "tester.cpp"))).toString("utf8");
      } catch {
      }
      if (tester === undefined) {
        const method = await vscode.window.showQuickPick(
          [
            { label: "Diff outputs (no tester)", description: "the judge diffs stdout against out/outputN.txt" },
            { label: "Include tester.cpp", description: "custom checker template — argv: input, jury output, user output; exit 0/1" },
          ],
          { title: "Judge method for problem.zip", ignoreFocusOut: true });
        if (!method) return;
        if (method.label.startsWith("Include")) tester = TESTER_CPP_TEMPLATE;
      }
      const names = [
        ...[...ins.keys()].map((n) => `in/input${n}.txt`),
        ...[...outs.keys()].map((n) => `out/output${n}.txt`),
      ];
      const v = validateBundle(names, tester !== undefined);
      if (!v.valid) {
        showFindings(
          "Fix the test folder before building problem.zip",
          v.errors.map((m) => ({ rule: "test-bundle", line: 0, severity: "error" as const, message: m })),
          v.warnings);
        return;
      }
      const nums = [...ins.keys()].sort((a, b) => a - b);
      const tests: TestCase[] = nums.map((n) => ({ input: ins.get(n)!, output: outs.get(n) ?? null }));
      const entries = buildTestBundle(tests, tester !== undefined ? { tester } : {});
      await writeEntries(dir, entries);
      const zip = zipStore(entries);
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, "problem.zip"), zip);
      vscode.window.showInformationMessage(
        `Built ${path.join(dir.fsPath, "problem.zip")} (${zip.length} bytes · ${v.inputCount} inputs · ${v.outputCount} outputs` +
        `${tester !== undefined ? " · tester.cpp" : ""}). in/ and out/ were refreshed alongside — upload problem.zip in the Quera judge settings.`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Build test bundle"));
    }
  });

  reg("queracode.insertTesterCpp", async () => {
    try {
      const dir = await testsRoot();
      const file = vscode.Uri.joinPath(dir, "tester.cpp");
      let exists = true;
      try {
        await vscode.workspace.fs.stat(file);
      } catch {
        exists = false;
      }
      if (!exists) await vscode.workspace.fs.writeFile(file, Buffer.from(TESTER_CPP_TEMPLATE));
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
      vscode.window.showInformationMessage(
        (exists ? "Opened the existing tester.cpp." : "Created tester.cpp from the template.") +
        " Contract: argv[1]=input, argv[2]=jury output, argv[3]=user output; exit 0 = correct, 1 = wrong. Edit compare() for special judges.");
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Insert tester.cpp"));
    }
  });

  reg("queracode.validateTestBundle", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const defaultUri = folder ? vscode.Uri.joinPath(folder.uri, getSettings().solutionsDir, "tests") : undefined;
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
      defaultUri, openLabel: "Validate bundle folder",
    });
    if (!picked?.length) return;
    try {
      const names: string[] = [];
      const walk = async (uri: vscode.Uri, prefix: string): Promise<void> => {
        for (const [name, type] of await vscode.workspace.fs.readDirectory(uri)) {
          const rel = prefix ? `${prefix}/${name}` : name;
          if (type === vscode.FileType.Directory) await walk(vscode.Uri.joinPath(uri, name), rel);
          else names.push(rel);
        }
      };
      await walk(picked[0], "");
      const v = validateBundle(names.filter((n) => n !== "problem.zip"), false);
      showFindings(
        `Test bundle: ${v.valid ? "valid" : "invalid"} (${v.inputCount} inputs · ${v.outputCount} outputs${v.hasTester ? " · tester" : ""})`,
        v.errors.map((m) => ({ rule: "test-bundle", line: 0, severity: "error" as const, message: m })),
        v.warnings);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Validate bundle"));
    }
  });

  reg("queracode.openDashboard", async () => openDashboard(service));

  reg("queracode.loadMore", () => providers.problemset.loadMore());

  reg("queracode.quickSubmit", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Open the file you want to submit first.");
      return;
    }
    const s = getSettings();
    if (!submissionAllowed(s)) {
      if (!(await offerEnable("enableSubmission", "Submitting to Quera is currently disabled"))) return;
    }
    const url = await vscode.window.showInputBox({
      prompt: "Quera problem URL or id (problemset / course / contest)",
      placeHolder: "https://quera.org/problemset/316836  ·  or  …/course/assignments/4367/problems/306549",
      ignoreFocusOut: true,
    });
    if (!url) return;
    const target = parseProblemUrl(url);
    if (!target) {
      vscode.window.showErrorMessage("Could not parse that as a Quera problem URL or id.");
      return;
    }
    try {
      const client = await service.getClient();
      const filename = path.basename(editor.document.uri.fsPath);
      const lang = languageForFile(editor.document.uri.fsPath, s.defaultLanguage);

      const problem = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Resolving problem ${target.problemId}…` },
        () => (target.assignmentId
          ? client.getAssignmentProblem(target.assignmentId, target.problemId, target.area || "course")
          : client.getProblem(target.problemId)));
      const tgt = submitTarget({
        assignment: target.assignmentId ? { pk: target.assignmentId } : problem.assignment,
        area: target.area || problem.area,
      });
      const name = problem.name || `#${target.problemId}`;
      const allowed = problem.allowed_file_types;
      if (tgt.area !== "problemset" && !tgt.aid) {
        vscode.window.showErrorMessage("That problem has no submit target (missing assignment id).");
        return;
      }
      const fileTypeId = resolveLiveFileTypeId({
        pk: target.problemId, aid: tgt.aid, type: problem.type || "J", lang, allowed });
      if (fileTypeId === undefined) {
        vscode.window.showErrorMessage(
          `«${name}» does not accept ${lang} (${path.extname(filename) || "no extension"}). ` +
          `Accepted: ${allowedLanguagesLabel(allowed)}.`);
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Submit ${filename} to “${name}” as ${lang} (file_type ${fileTypeId})? This consumes an attempt.`,
        { modal: true }, "Submit");
      if (confirm !== "Submit") return;
      await editor.document.save();
      await snapshotFile(editor.document.uri, `quick-submit-p${target.problemId}`).catch(() => undefined);
      const res = await client.submitFile(
        tgt.aid, target.problemId, filename, editor.document.getText(), fileTypeId, tgt.area);
      await announceSubmission(name, target.problemId, { aid: tgt.aid, area: tgt.area });
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Quick submit"));
    }
  });

  reg("queracode.saveProblem", async (arg: number | ProblemDetail) => {
    try {
      let problem: ProblemDetail;
      if (isProblemDetail(arg)) problem = arg as ProblemDetail;
      else {
        let pk = extractPk(arg) ?? 0;
        if (!pk) {
          const idStr = await vscode.window.showInputBox({
            prompt: "Problem id or URL", ignoreFocusOut: true,
            validateInput: (v) => {
              const t = v.trim();
              if (!t) return "Enter a problem id or a quera.org URL";
              return parseProblemUrl(t) || /^\d+$/.test(t)
                ? undefined : "Not a problem id or a recognizable Quera URL";
            },
          });
          if (!idStr) return;
          pk = parseProblemUrl(idStr.trim())?.problemId ?? Number(idStr.trim());
        }
        problem = await fetchProblem(pk);
      }
      if (!problem?.pk) {
        vscode.window.showErrorMessage("Could not resolve this problem's id — nothing was saved.");
        return;
      }
      const dir = await solutionsRoot(`problems/${problem.pk}`);
      const meta = {
        pk: problem.pk, name: problem.name, difficulty: problem.difficulty, score: problem.score,
        tags: (problem.tags || []).map((t) => t.name), assignment: problem.assignment ?? null,
        allowed_file_types: problem.allowed_file_types ?? [],
        area: problem.area ?? null,
        url: problemUrl(problem.pk, problem.area ?? undefined, problem.assignment?.pk),
        saved_at: new Date().toISOString(),
      };
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(dir, "statement.md"),
        Buffer.from(`# ${problem.name || "مسئله " + problem.pk}\n\n${problem.description || ""}`));
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(dir, "problem.json"), Buffer.from(JSON.stringify(meta, null, 2)));
      const samples = extractSamples(problem.description || "").filter((x) => x.input !== null);
      for (const [i, sm] of samples.entries()) {
        await writeFileInto(vscode.Uri.joinPath(dir, `tests/sample${i + 1}.in`), Buffer.from(sm.input || ""));
        if (sm.output) await writeFileInto(vscode.Uri.joinPath(dir, `tests/sample${i + 1}.out`), Buffer.from(sm.output));
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(dir, "statement.md"));
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(
        `Saved “${problem.name}” locally (statement.md, problem.json${samples.length ? `, ${samples.length} sample tests` : ""}).`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Save problem"));
    }
  });

  reg("queracode.addCustomTest", async () => {
    const editor = await resolveSolutionEditor();
    if (!editor) {
      vscode.window.showWarningMessage("No solution file found — use 'Solve Problem' first, or open your file.");
      return;
    }
    const input = await vscode.window.showInputBox({
      prompt: "Test INPUT (use \\n for new lines)", ignoreFocusOut: true });
    if (input === undefined) return;
    const output = await vscode.window.showInputBox({
      prompt: "Expected OUTPUT (optional — leave empty to only run)", ignoreFocusOut: true });
    const dir = vscode.Uri.joinPath(vscode.Uri.file(path.dirname(editor.document.uri.fsPath)), "tests");
    await vscode.workspace.fs.createDirectory(dir);
    const existing = (await vscode.workspace.fs.readDirectory(dir)).filter(([n]) => /^custom\d+\.in$/.test(n)).length;
    const n = existing + 1;
    const unescape = (t: string) => t.replace(/\\n/g, "\n");
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, `custom${n}.in`), Buffer.from(unescape(input) + "\n"));
    if (output) await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, `custom${n}.out`), Buffer.from(unescape(output) + "\n"));
    vscode.window.showInformationMessage(`Added custom test #${n}. 'Run Solution on Samples' now includes it.`);
  });

  reg("queracode.snapshotVersion", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const label = await vscode.window.showInputBox({ prompt: "Snapshot label", value: "manual", ignoreFocusOut: true });
    if (label === undefined) return;
    const uri = await snapshotFile(editor.document.uri, label || "manual");
    vscode.window.showInformationMessage(`Snapshot saved: ${path.basename(uri.fsPath)}`);
  });

  reg("queracode.versionHistory", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const versions = await listVersions(editor.document.uri);
    if (!versions.length) {
      vscode.window.showInformationMessage("No snapshots for this file yet ('Quera: Snapshot Version', or submit/publish once).");
      return;
    }
    const pick = await vscode.window.showQuickPick(
      versions.map((v) => ({ label: `$(history) ${v.timestamp}`, description: v.label, v })),
      { title: `${versions.length} snapshot(s) — pick one`, ignoreFocusOut: true });
    if (!pick) return;
    const action = await vscode.window.showQuickPick(
      [
        { label: "$(diff) Compare with current", act: "diff" },
        { label: "$(discard) Restore this version", act: "restore" },
        { label: "$(go-to-file) Open snapshot", act: "open" },
      ], { title: pick.v.fileName });
    if (!action) return;
    if (action.act === "diff") {
      await vscode.commands.executeCommand("vscode.diff", pick.v.uri, editor.document.uri,
        `${path.basename(editor.document.uri.fsPath)}: ${pick.v.timestamp} ↔ current`);
    } else if (action.act === "restore") {
      await restoreVersion(editor.document.uri, pick.v.uri);
      vscode.window.showInformationMessage("Version restored (the previous state was snapshotted first).");
    } else {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(pick.v.uri));
    }
  });

  const insertAt = async (line: number | undefined, text: string) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const pos = line !== undefined
      ? new vscode.Position(Math.min(line, editor.document.lineCount), 0)
      : editor.selection.active;
    await editor.edit((e) => e.insert(pos, text));
  };
  reg("queracode.insertSampleTest", (line?: number) => insertAt(line, SAMPLE_TEST_SNIPPET));
  reg("queracode.insertLimits", (line?: number) => insertAt(line, LIMITS_SNIPPET));
  reg("queracode.insertAccordion", (line?: number) => insertAt(line, ACCORDION_SNIPPET));
  reg("queracode.insertCodeBlock", async (line?: number) => {
    const lang = await vscode.window.showQuickPick(
      ["python", "cpp", "java", "javascript", "go", "text"], { title: "Code block language" });
    if (!lang) return;
    await insertAt(line, codeBlockSnippet(lang === "text" ? "" : lang));
  });

  reg("queracode.solveWithClaudeCode", async (arg: number | ProblemDetail) => {
    let problem: ProblemDetail | undefined;
    if (isProblemDetail(arg)) problem = arg as ProblemDetail;
    else {
      const pk = await resolveProblemId(arg, "Which problem?");
      if (pk === undefined) return;
      problem = await fetchProblem(pk);
    }
    if (!problem?.pk) {
      vscode.window.showWarningMessage("Open or pick a problem first.");
      return;
    }
    await registerMcpServer(false).catch(() => undefined);
    const dir = await solutionsRoot(`problem-${problem.pk}`);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(dir, "statement.md"),
      Buffer.from(`# ${problem.name || "مسئله " + problem.pk}\n\n${problem.description || ""}`));
    const brief =
      `Solve the Quera problem "${problem.name}" (#${problem.pk}, difficulty ${problem.difficulty}). ` +
      `The statement is in ${vscode.workspace.asRelativePath(dir)}/statement.md. ` +
      `Write the solution, test it against the samples, and leave it in that folder. Do NOT submit.`;
    const term = vscode.window.createTerminal({ name: `Claude · ${problem.name || problem.pk}` });
    term.show();
    term.sendText(`claude ${JSON.stringify(brief)}`, true);
  });

  reg("queracode.openContestProblem", async (a: any, b?: any, name?: string) => {
    const [aid, pid] = idsFrom(a, [b], ["assignmentId", "problemId"]) as number[];
    if (a && typeof a === "object" && a.label) name = name ?? String(a.label);
    if (!aid || !pid) return;
    const panel = showLoading("queracode.contestProblem", name || `Contest problem ${pid}`);
    try {
      const client = await service.getClient();
      const md = await client.getCourseProblemMarkdown(aid, pid, "contest");
      panel.dispose();
      showPreview(name || `Contest problem ${pid}`, md);
      const act = await vscode.window.showInformationMessage(
        `Loaded "${name || pid}". Solve it now?`, "Solve", "Save locally");
      if (act === "Solve") await vscode.commands.executeCommand("queracode.solveContestProblem", aid, pid, name);
      else if (act === "Save locally") {
        const dir = await solutionsRoot(`contest-${aid}/problem-${pid}`);
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, "statement.md"), Buffer.from(md));
        vscode.window.showInformationMessage("Statement saved.");
      }
    } catch (e: any) {
      panel.dispose();
      vscode.window.showErrorMessage(explainError(e, "Open contest problem"));
    }
  });

  reg("queracode.solveContestProblem", async (a: any, b?: any, name?: string) => {
    const [aid, pid] = idsFrom(a, [b], ["assignmentId", "problemId"]) as number[];
    if (a && typeof a === "object" && a.label) name = name ?? String(a.label);
    if (!aid || !pid) return;
    const langKey = await vscode.window.showQuickPick(
      LANGUAGES.map((l) => ({ label: l.label, description: l.key })),
      { title: "Language for your contest solution", ignoreFocusOut: true });
    if (!langKey) return;
    const info = langByKey(langKey.description!)!;
    const dir = await solutionsRoot(`contest-${aid}/problem-${pid}`);
    const file = vscode.Uri.joinPath(dir, (info.key === "java" ? "Main" : "solution") + info.ext);
    try { await vscode.workspace.fs.stat(file); } catch {
      await vscode.workspace.fs.writeFile(file, Buffer.from(scaffold(info.key, name || `Contest ${aid} / ${pid}`)));
    }
    solutionMap.set(file.fsPath, { pk: pid, aid, type: "J", lang: info.key, area: "contest" });
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    vscode.commands.executeCommand("setContext", "queracode.canSubmit", true);
  });

  reg("queracode.sendToCph", async (arg: number | ProblemDetail) => {
    let problem: ProblemDetail;
    try {
      if (typeof arg === "object" && arg?.description) problem = arg;
      else {
        let pk = typeof arg === "number" ? arg : Number(arg?.pk);
        if (!pk) {
          const idStr = await vscode.window.showInputBox({
            prompt: "Problem id or URL", ignoreFocusOut: true,
            validateInput: (v) => {
              const t = v.trim();
              if (!t) return "Enter a problem id or a quera.org URL";
              return parseProblemUrl(t) || /^\d+$/.test(t)
                ? undefined : "Not a problem id or a recognizable Quera URL";
            },
          });
          if (!idStr) return;
          pk = parseProblemUrl(idStr.trim())?.problemId ?? Number(idStr.trim());
        }
        problem = await fetchProblem(pk);
      }
      const samples = extractSamples(problem.description || "").filter((t) => t.input !== null);
      const payload = {
        name: problem.name || `Quera ${problem.pk}`,
        group: "Quera",
        url: problemUrl(problem.pk),
        interactive: false,
        memoryLimit: 256,
        timeLimit: 1000,
        tests: samples.map((t) => ({ input: t.input || "", output: t.output || "" })),
        testType: "single",
        input: { type: "stdin" },
        output: { type: "stdout" },
        languages: { java: { mainClass: "Main", taskClass: (problem.name || "Task").replace(/\W+/g, "") } },
        batch: { id: `quera-${problem.pk}`, size: 1 },
      };
      const res = await fetch("http://localhost:27121/", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }).catch(() => undefined);
      if (res) {
        vscode.window.showInformationMessage(
          `Sent "${payload.name}" (${payload.tests.length} tests) to Competitive Companion listeners (CPH/JHelper/acmX).`);
      } else {
        vscode.window.showWarningMessage(
          "No Competitive Companion listener on port 27121. Install 'Competitive Programming Helper (CPH)' and keep it open, then retry.");
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Send to CPH"));
    }
  });

  reg("queracode.setupCpLibrary", async () => {
    const libs = [
      { label: "AtCoder Library (ac-library)", url: "https://github.com/atcoder/ac-library", dir: "lib/ac-library",
        hint: "C++: compile with  -I lib/ac-library   then  #include <atcoder/all>" },
      { label: "ac-library-python", url: "https://github.com/not522/ac-library-python", dir: "lib/ac-library-python",
        hint: "Python: pip install -e lib/ac-library-python  ->  from atcoder import ..." },
      { label: "KACTL (KTH ICPC notebook)", url: "https://github.com/kth-competitive-programming/kactl", dir: "lib/kactl",
        hint: "Battle-tested C++ snippets in content/ — copy what you need." },
      { label: "testlib.h (generators/validators)", url: "https://github.com/MikeMirzayanov/testlib", dir: "lib/testlib",
        hint: "Put testlib.h next to your TPS gen/ and validator/ sources." },
      { label: "cp-algorithms (reference book)", url: "https://github.com/cp-algorithms/cp-algorithms", dir: "lib/cp-algorithms",
        hint: "The e-maxx English algorithm reference, offline." },
    ];
    const pick = await vscode.window.showQuickPick(
      libs.map((l) => ({ label: l.label, description: l.url, l })),
      { title: "Clone a competitive-programming library into the workspace", ignoreFocusOut: true });
    if (!pick) return;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showWarningMessage("Open a workspace folder first.");
      return;
    }
    const term = vscode.window.createTerminal({ name: `Quera · ${pick.l.label}` });
    term.show();
    term.sendText(`git clone --depth 1 ${pick.l.url} "${pick.l.dir}"`, true);
    vscode.window.showInformationMessage(`Cloning ${pick.l.label} -> ${pick.l.dir}. ${pick.l.hint}`);
  });

  reg("queracode.submitFileToProblem", async (problem: ProblemDetail, pick?: boolean) => {
    if (!problem?.pk) return;
    const tgt = submitTarget(problem);
    const aid = tgt.aid;
    if (tgt.area !== "problemset" && !aid) {
      vscode.window.showErrorMessage("This problem has no submit target (missing assignment id).");
      return;
    }
    const s = getSettings();
    if (!submissionAllowed(s)) {
      if (!(await offerEnable("enableSubmission", "Submitting to Quera is currently disabled"))) return;
    }
    let fileUri: vscode.Uri | undefined;
    let content: string | Buffer | undefined;
    if (pick) {
      const chosen = await vscode.window.showOpenDialog({
        canSelectMany: false, openLabel: "Submit this file",
        title: `ارسال پاسخ برای «${problem.name}»`,
      });
      if (!chosen?.length) return;
      fileUri = chosen[0];
      content = Buffer.from(await vscode.workspace.fs.readFile(fileUri));
    } else {
      const editor = await resolveSolutionEditor(Number(problem.pk));
      if (!editor) {
        vscode.window.showWarningMessage("Open the file you want to submit (or use 'Choose file & submit').");
        return;
      }
      await editor.document.save();
      fileUri = editor.document.uri;
      content = editor.document.getText();
    }
    const ext = path.extname(fileUri.fsPath).toLowerCase();
    const lang = (LANGUAGES.find((l) => l.ext === ext)?.key) || s.defaultLanguage;
    const fileTypeId = resolveLiveFileTypeId({
      pk: Number(problem.pk), aid, type: problem.type || "J", lang, allowed: problem.allowed_file_types });
    if (fileTypeId === undefined) {
      vscode.window.showErrorMessage(
        `«${problem.name}» does not accept ${lang}. ` +
        `Accepted: ${allowedLanguagesLabel(problem.allowed_file_types)}.`);
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Submit ${path.basename(fileUri.fsPath)} to "${problem.name}" (file_type ${fileTypeId})? This consumes an attempt.`,
      { modal: true }, "Submit");
    if (confirm !== "Submit") return;
    try {
      await snapshotFile(fileUri, `submit-p${problem.pk}`).catch(() => undefined);
      const client = await service.getClient();
      const res = await client.submitFile(
        aid, Number(problem.pk), path.basename(fileUri.fsPath), content!, fileTypeId, tgt.area);
      await announceSubmission(problem.name || `#${problem.pk}`, Number(problem.pk),
        { aid, area: tgt.area });
      if (problem.area && aid !== null) {
        const subs = await client.getAssignmentSubmissions(aid, problem.area, Number(problem.pk)).catch(() => []);
        if (subs.length) providers.submissions.set(problem.name || `#${problem.pk}`, subs as any);
      } else {
        const refreshed = await fetchProblem(Number(problem.pk), "submissions").catch(() => undefined);
        if (refreshed?.submissions?.items) providers.submissions.set(refreshed.name || `#${problem.pk}`, refreshed.submissions.items);
      }
    } catch (e: any) {
      const msg = /404/.test(String(e?.message))
        ? `Submit failed (HTTP 404): «${problem.name}» در حال حاضر پاسخ نمی‌پذیرد — مهلت/مسابقه تمام شده یا ارسال فقط از خود quera.org ممکن است.`
        : `Submit failed: ${e?.message || e}`;
      vscode.window.showErrorMessage(msg);
    }
  });

  reg("queracode.openProblemByUrl", async (input?: string) => {
    const url = input || await vscode.window.showInputBox({
      prompt: "Quera problem URL or id",
      placeHolder: "https://quera.org/course/assignments/57453/problems/239642  ·  or  316836",
      ignoreFocusOut: true,
    });
    if (!url) return;
    const target = parseProblemUrl(url);
    if (!target) {
      vscode.window.showErrorMessage("Could not parse that as a Quera problem URL or id.");
      return;
    }
    if (target.kind === "problemset" || !target.assignmentId) {
      await vscode.commands.executeCommand("queracode.openProblem", target.problemId);
      return;
    }
    const panel = showLoading("queracode.problem", `Problem ${target.problemId}`);
    try {
      const client = await service.getClient();
      const problem = await client.getAssignmentProblem(
        target.assignmentId, target.problemId, target.area || "course");
      const subs = await client.getAssignmentSubmissions(
        target.assignmentId, target.area || "course", target.problemId).catch(() => []);
      if (subs.length) {
        problem.submissions = { items: subs as any, total: subs.length };
        providers.submissions.set(problem.name || `#${problem.pk}`, subs as any);
      }
      showProblem(problem, panel);
    } catch (e: any) {
      panel.dispose();
      vscode.window.showErrorMessage(explainError(e, "Open problem"));
    }
  });

  reg("queracode.readCollegeLesson", async (a: any, b?: any, c?: any, name?: string) => {
    const [collegeId, chapterId, lessonId] = idsFrom(a, [b, c], ["collegeId", "chapterId", "lessonId"]) as number[];
    if (a && typeof a === "object" && a.label) name = name ?? String(a.label);
    if (![collegeId, chapterId, lessonId].every((v) => Number.isFinite(v) && v > 0)) {
      vscode.window.showWarningMessage(
        "Open a college lesson from the Courses view — this command needs the college, chapter and lesson it belongs to.");
      return;
    }
    const panel = showLoading("queracode.preview", name || `Lesson ${lessonId}`);
    try {
      const client = await service.getClient();
      const { current, chapters, collegeName } = await client.getCollegeLesson(collegeId, chapterId, lessonId);
      if (!current?.description) {
        panel.dispose();
        vscode.window.showWarningMessage(
          "این درسنامه هنوز برای شما باز نشده است (باید موارد قبلی را کامل کنید).");
        return;
      }
      const progress = (chapters || [])
        .flatMap((a: any) => a.problems || [])
        .find((p: any) => Number(p.id) === Number(current.id));
      const detail: ProblemDetail = {
        pk: Number(current.id) || lessonId,
        name: current.name || name || `Lesson ${lessonId}`,
        description: current.description,
        score: current.problem_score,
        gained_score: progress?.gained_score,
        area: "course",
        can_submit: !!(current.is_judgeable || current.has_submission_upload),
      };
      if (current.training_type === "LSN" && !current.is_judgeable) {
        panel.dispose();
        const ordered = (chapters || []).flatMap((a: any) =>
          (a.problems || []).map((p: any) => ({ chapterId: Number(a.id), lessonId: Number(p.id), name: String(p.name || "") })));
        const idx = ordered.findIndex((x: any) => x.lessonId === Number(current.id));
        const asNav = (x: any) => x && { collegeId, chapterId: x.chapterId, lessonId: x.lessonId, name: x.name };
        showPreview(`${detail.name}${collegeName ? ` — ${collegeName}` : ""}`, detail.description || "", {
          annotKey: `college:${collegeId}:${current.id}`,
          prev: idx > 0 ? asNav(ordered[idx - 1]) : undefined,
          next: idx >= 0 && idx < ordered.length - 1 ? asNav(ordered[idx + 1]) : undefined,
        });
      } else {
        showProblem(detail, panel);
      }
    } catch (e: any) {
      panel.dispose();
      vscode.window.showErrorMessage(explainError(e, "Open college lesson"));
    }
  });

  reg("queracode.openLibraryItem", openLibraryItem);

  reg("queracode.publishToAssignment", async () => {
    if (!writeAllowed(getSettings())) {
      if (!(await offerEnable("enableWrite", "Publishing content to Quera is currently disabled"))) return;
    }
    const url = await vscode.window.showInputBox({
      prompt: "Assignment URL (course/college) — e.g. https://quera.org/course/assignments/105409/add_problem",
      ignoreFocusOut: true,
    });
    if (!url) return;
    const m = url.trim().match(/(course|college|contest)\/assignments\/(\d+)/) || url.trim().match(/^(\d+)$/);
    if (!m) {
      vscode.window.showErrorMessage("Could not parse an assignment id from that URL.");
      return;
    }
    const area = (m.length === 3 ? m[1] : "course") as "course" | "college" | "contest";
    const aid = Number(m.length === 3 ? m[2] : m[1]);
    const mode = await vscode.window.showQuickPick(
      [
        { label: "درسنامه — متن Markdown فعال", description: "lesson", detail: "type F · محتوای فایل مارک‌داون باز" },
        { label: "تمرین کدی + جاج", description: "judge", detail: "type J · zip تست‌ها + پروژهٔ اولیهٔ اختیاری" },
        { label: "تمرین آپلودی", description: "upload", detail: "type U · بدون جاج کدی" },
      ],
      { title: `افزودن به تمرین #${aid} (${area})`, ignoreFocusOut: true });
    if (!mode) return;
    const name = await vscode.window.showInputBox({ prompt: "عنوان (name)", ignoreFocusOut: true });
    if (!name) return;
    let description: string | undefined;
    if (mode.description === "lesson") {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "markdown") {
        vscode.window.showWarningMessage("Open the lesson Markdown file first.");
        return;
      }
      const findings = lintMarkdown(editor.document.getText());
      if (findings.some((f) => f.severity === "error")) {
        showFindings("Fix these Markdown errors before publishing", findings);
        return;
      }
      description = editor.document.getText();
    }
    const scoreStr = mode.description === "lesson" ? "100" : (await vscode.window.showInputBox({
      prompt: "نمره (score)", value: "100", ignoreFocusOut: true })) || "";
    if (!scoreStr) return;
    const readZip = async (title: string): Promise<{ filename: string; bytes: Buffer } | undefined> => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false, title, filters: { "Zip archives": ["zip"] } });
      if (!picked?.length) return undefined;
      return {
        filename: path.basename(picked[0].fsPath),
        bytes: Buffer.from(await vscode.workspace.fs.readFile(picked[0])),
      };
    };
    let testsZip, initZip;
    if (mode.description === "judge") {
      testsZip = await readZip("Zip تست‌ها / جاج (الزامی برای تمرین کدی)");
      if (!testsZip) return;
      initZip = await readZip("پروژهٔ اولیه (اختیاری — Esc برای رد)");
    } else if (mode.description === "upload") {
      initZip = await readZip("پروژهٔ اولیه (اختیاری — Esc برای رد)");
    }
    const confirm = await vscode.window.showWarningMessage(
      `«${name}» به تمرین #${aid} اضافه شود؟ این محتوای زندهٔ درس را تغییر می‌دهد.`,
      { modal: true }, "Publish");
    if (confirm !== "Publish") return;
    try {
      const client = await service.getClient();
      const listArea = area === "contest" ? "contest" : "course";
      const before = new Set(
        (await client.listAssignmentItems(aid, listArea).catch(() => [])).map((i) => i.id));
      const res = await client.addAssignmentProblem(aid, {
        area,
        name,
        description,
        score: Number(scoreStr),
        type: mode.description === "lesson" ? "F" : mode.description === "upload" ? "U" : "J",
        testsZip,
        initialProjectZip: initZip,
      });
      const after = await client.listAssignmentItems(aid, listArea).catch(() => []);
      const created = after.find((i) => !before.has(i.id));
      providers.courses.refresh();
      vscode.window.showInformationMessage(
        created
          ? `«${created.name}» ساخته شد (#${created.id}).`
          : `Quera پاسخ داد (HTTP ${res.status}) اما مورد تازه‌ای اضافه نشد — ممکن است دسترسی لازم را نداشته باشید.`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Publish to assignment"));
    }
  });

  const askAdvancedSpec = async (kind: InputKind, count: number): Promise<any | undefined> => {
    const defaults: Record<InputKind, Record<string, unknown>> = {
      single_int: { vMin: 0, vMax: 1_000_000 },
      array: { nMin: 1, nMax: 20, vMin: -100, vMax: 100 },
      matrix: { rowsMin: 1, rowsMax: 8, colsMin: 1, colsMax: 8, vMin: 0, vMax: 9 },
      string: { lenMin: 1, lenMax: 40, alphabet: "abcdefghijklmnopqrstuvwxyz" },
      graph: { nMin: 2, nMax: 12, edgeRatio: 1.5 },
      pairs: { nMin: 1, nMax: 15, vMin: -1000, vMax: 1000 },
    };
    const raw = await vscode.window.showInputBox({
      prompt: "تنظیمات پیشرفتهٔ تولید تست (JSON) — Enter برای پیش‌فرض",
      value: JSON.stringify(defaults[kind]),
      ignoreFocusOut: true,
      validateInput: (v) => {
        try { JSON.parse(v || "{}"); return undefined; } catch { return "JSON نامعتبر"; }
      },
    });
    if (raw === undefined) return undefined;
    return { kind, count, ...JSON.parse(raw || "{}") };
  };

  reg("queracode.autoGenerateTests", async () => {
    const editor = await resolveSolutionEditor();
    if (!editor) {
      vscode.window.showWarningMessage("Open your solution file first — it produces the expected outputs.");
      return;
    }
    const mode = getSettings().sandbox;
    if (mode === "none") {
      vscode.window.showWarningMessage(
        "The sample runner is off (queracode.sandbox = none). Switch it to docker or local to auto-generate outputs.");
      return;
    }
    const kindPick = await vscode.window.showQuickPick(
      INPUT_KINDS.map((k) => ({ label: k })),
      { title: "نوع ورودی تست · input shape", ignoreFocusOut: true });
    if (!kindPick) return;
    const countStr = await vscode.window.showInputBox({
      prompt: "How many tests? (1–100)", value: "10", ignoreFocusOut: true,
      validateInput: (v) => (/^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 100 ? undefined : "1–100"),
    });
    if (!countStr) return;
    const seedStr = await vscode.window.showInputBox({
      prompt: "Seed (same seed → same tests; blank = 0)", ignoreFocusOut: true });
    if (seedStr === undefined) return;
    const spec = await askAdvancedSpec(kindPick.label as InputKind, Number(countStr));
    if (!spec) return;
    let inputs: string[];
    try {
      inputs = generateInputs(spec, seedStr.trim() || undefined);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Generate inputs"));
      return;
    }
    await editor.document.save();
    const ext = path.extname(editor.document.uri.fsPath).toLowerCase();
    const ctx = solutionMap.get(editor.document.uri.fsPath);
    const lang = ctx?.lang || (LANGUAGES.find((l) => l.ext === ext)?.key) || getSettings().defaultLanguage;
    const baseDir = vscode.Uri.file(path.dirname(editor.document.uri.fsPath));
    const failures: number[] = [];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Generating tests from your solution…", cancellable: true },
      async (progress, tokenC) => {
        for (const [i, input] of inputs.entries()) {
          if (tokenC.isCancellationRequested) return;
          progress.report({ message: `test ${i + 1}/${inputs.length}`, increment: 100 / inputs.length });
          const run = await runSample(lang, editor.document.uri.fsPath, input, mode);
          const n = i + 1;
          await writeFileInto(
            vscode.Uri.joinPath(baseDir, "in", `input${n}.txt`), Buffer.from(input));
          if (run.code === 0 && !run.timedOut) {
            const out = run.stdout.endsWith("\n") ? run.stdout : run.stdout + "\n";
            await writeFileInto(
              vscode.Uri.joinPath(baseDir, "out", `output${n}.txt`), Buffer.from(out));
            await writeFileInto(
              vscode.Uri.joinPath(baseDir, "tests", `gen${n}.in`), Buffer.from(input));
            await writeFileInto(
              vscode.Uri.joinPath(baseDir, "tests", `gen${n}.out`), Buffer.from(out));
          } else {
            failures.push(n);
          }
        }
      });
    if (failures.length) {
      vscode.window.showWarningMessage(
        `Generated ${inputs.length - failures.length}/${inputs.length} tests — the solution failed on inputs ` +
        `${failures.join(", ")} (in/input*.txt kept so you can debug).`);
    } else {
      vscode.window.showInformationMessage(
        `ساخته شد: ${inputs.length} تست کامل (in/input*.txt + out/output*.txt). ` +
        "Build Test Bundle turns them into the judge zip.");
    }
  });

  reg("queracode.initJudge", async () => {
    const pick = await vscode.window.showQuickPick(
      JUDGE_KINDS.map((k) => ({ label: k.label, description: k.key, detail: k.detail })),
      { title: "Init a Quera project judge · سیستم داوری کوئرا", ignoreFocusOut: true });
    if (!pick) return;
    const kind = JUDGE_KINDS.find((k) => k.key === pick.description)!;
    const dir = await solutionsRoot(`judges/${kind.key}-judge`);
    for (const [rel, content] of Object.entries(kind.files)) {
      const target = vscode.Uri.joinPath(dir, ...rel.split("/"));
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(dir, ...rel.split("/").slice(0, -1)));
      await vscode.workspace.fs.writeFile(target, Buffer.from(content));
    }
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(vscode.Uri.joinPath(dir, "tester_config.json")));
    vscode.window.showInformationMessage(
      `${kind.label} judge scaffolded → ${getSettings().solutionsDir}/judges/${kind.key}-judge. ` +
      "Fill the tests, then 'Generate tester_config from tests' keeps number_of_tests honest.");
  });

  reg("queracode.generateTesterConfig", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("Open the judge's main test file first (test.py / main.test.js).");
      return;
    }
    const names = extractTestNames(editor.document.getText());
    if (!names.length) {
      vscode.window.showWarningMessage("No test functions found in this file (looked for def test_* / test()/it()).");
      return;
    }
    const signature = await vscode.window.showInputBox({
      prompt: "solution_signature — the file every submission must contain",
      value: "main.py", ignoreFocusOut: true });
    if (!signature) return;
    const single = (await vscode.window.showQuickPick(["single file", "project ZIP"],
      { title: "How do users submit?" })) === "single file";
    const dir = vscode.Uri.file(path.dirname(editor.document.uri.fsPath));
    const target = vscode.Uri.joinPath(dir, "tester_config.json");
    await vscode.workspace.fs.writeFile(target, Buffer.from(generateTesterConfig(signature, single, names)));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
    vscode.window.showInformationMessage(
      `tester_config.json generated: ${names.length} tests found and grouped. Adjust package names/scores to taste.`);
  });

  reg("queracode.generateValidFiles", async () => {
    const editor = vscode.window.activeTextEditor;
    const base = editor
      ? vscode.Uri.file(path.dirname(editor.document.uri.fsPath))
      : vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!base) return;
    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(base, "**/*"), "**/{node_modules,.git,__pycache__}/**", 500);
    const rels = found.map((f) => path.relative(base.fsPath, f.fsPath));
    const target = vscode.Uri.joinPath(base, "valid_files");
    await vscode.workspace.fs.writeFile(target, Buffer.from(generateValidFiles(rels)));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
    vscode.window.showInformationMessage(
      "valid_files generated — every path a user may upload. Trim judge-only files if any slipped through.");
  });

  reg("queracode.insertImage", async (line?: number) => {
    const url = await vscode.window.showInputBox({
      prompt: "Image URL or images/<name>.png path", ignoreFocusOut: true });
    if (url === undefined) return;
    const alt = await vscode.window.showInputBox({ prompt: "Alt text (فارسی)", ignoreFocusOut: true });
    await insertAt(line, `\n![${alt || "تصویر"}](${url || "images/example.png"})\n`);
  });

  reg("queracode.insertTable", async (line?: number) => {
    const spec = await vscode.window.showInputBox({
      prompt: "Columns, comma-separated (e.g. ورودی,خروجی)", value: "ستون ۱,ستون ۲", ignoreFocusOut: true });
    if (spec === undefined) return;
    const cols = spec.split(",").map((c) => c.trim()).filter(Boolean);
    if (!cols.length) return;
    const table = `\n| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |\n| ${cols.map(() => " ").join(" | ")} |\n`;
    await insertAt(line, table);
  });

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider("markdown", {
      provideCompletionItems(doc, pos) {
        const prefix = doc.lineAt(pos.line).text.slice(0, pos.character);
        const items: vscode.CompletionItem[] = [];
        if (/%[a-z_.]*$/.test(prefix)) {
          for (const token of MACROS) {
            const it = new vscode.CompletionItem(token, vscode.CompletionItemKind.Snippet);
            it.detail = "Quera macro";
            it.insertText = token.replace(/^%/, "");
            items.push(it);
          }
        }
        if (/<d?e?t?a?i?l?s?$/.test(prefix) || /^:::?$/.test(prefix.trim())) {
          const it = new vscode.CompletionItem("details (accordion)", vscode.CompletionItemKind.Snippet);
          it.insertText = new vscode.SnippetString(
            '<details class="${1|blue,green,red,yellow|}">\n<summary>${2:عنوان}</summary>\n\n$0\n\n</details>');
          items.push(it);
        }
        if (/<ma?r?k?$/.test(prefix)) {
          const it = new vscode.CompletionItem("mark (highlight)", vscode.CompletionItemKind.Snippet);
          it.insertText = new vscode.SnippetString('<mark class="${1|yellow,blue,green,red|}" title="${2:توضیح}">$0</mark>');
          items.push(it);
        }
        return items;
      },
    }, "%", "<", ":"));
}

export function registerRepoCommands(
  context: vscode.ExtensionContext,
  service?: QueraService,
  sync?: { discover(): Promise<void>; pushNow(): Promise<void>; autoPull(silent?: boolean): Promise<void> },
  repoTree?: { refresh(): void },
  direct?: DirectSync
): void {
  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("queracode.repoLink", async () => {
    if (!service) return;
    const folders = vscode.workspace.workspaceFolders || [];
    if (!folders.length) {
      vscode.window.showWarningMessage("Open the folder you want to use as the course repository first.");
      return;
    }
    const folder = folders.length === 1
      ? folders[0]
      : await vscode.window.showWorkspaceFolderPick({ placeHolder: "Which folder is the course repository?" });
    if (!folder) return;
    const root = folder.uri.fsPath;

    let colleges: { id: number; name: string; slug?: string }[] = [];
    try {
      colleges = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Loading your colleges…" },
        async () => {
          const client = await service.getClient();
          const user = await client.whoami();
          return (user?.my_colleges || []).map((c: any) => {
            const m = String(c.url || "").match(/college\/(?:land\/college\/|landpage\/)?(\d+)(?:\/([^/?#]+))?/);
            return { id: Number(c.pk ?? c.id ?? m?.[1]), name: c.name || `College ${c.pk ?? c.id}`, slug: m?.[2] };
          }).filter((c: any) => Number.isFinite(c.id) && c.id > 0);
        });
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "List your colleges"));
      return;
    }
    if (!colleges.length) {
      vscode.window.showWarningMessage("This account has no colleges to link.");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      colleges.map((c) => ({ label: c.name, description: `#${c.id}`, college: c })),
      { title: "Which college does this repository publish?", ignoreFocusOut: true });
    if (!picked) return;
    const college = (picked as any).college as { id: number; name: string; slug?: string };

    const lessonFile = await vscode.window.showQuickPick(
      [DEFAULT_LESSON_FILE, "lesson.md"],
      { title: "What is each lesson's Markdown file called?", ignoreFocusOut: true });
    if (!lessonFile) return;
    const chapterDir = await vscode.window.showInputBox({
      title: "Where do chapter folders live?",
      prompt: "Repo-relative folder holding the chapters — blank for the repository root.",
      value: "course", ignoreFocusOut: true,
    });
    if (chapterDir === undefined) return;

    try {
      const client = await service.getClient();
      const tree = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Reading «${college.name}» chapters…` },
        () => client.getCollegeChapters(college.id, college.slug));
      const existing = await readSyncConfig(root);
      const config = buildSyncConfig(
        { id: college.id, landingUrl: college.slug ? `${queraOrigin()}/college/landpage/${college.id}/${college.slug}` : undefined },
        tree.chapters.map((c) => ({ name: c.name, id: 0 })),
        { lessonFile, chapterDir: chapterDir.trim().replace(/^\/|\/$/g, ""), previous: existing }
      );
      await writeSyncConfig(root, config);
      if (!(await isGitRepo(root))) {
        const initPick = await vscode.window.showInformationMessage(
          "This folder is not a Git repository yet. Initialize one?", "Initialize", "Not now");
        if (initPick === "Initialize") {
          const remote = await vscode.window.showInputBox({
            title: "Remote URL (optional)",
            prompt: "git@github.com:you/your-course.git — leave blank to add it later",
            ignoreFocusOut: true,
          });
          await initRepo(root, remote?.trim() || undefined);
        }
      }
      await sync?.discover();
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, SYNC_CONFIG));
      await vscode.window.showTextDocument(doc, { preview: false });
      vscode.window.showInformationMessage(
        `Linked «${college.name}» — ${config.chapters.length} chapter folder(s) ready. ` +
          "Add QUERA_SESSION_ID as a repository secret so the sync workflow can publish.");
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Link college"));
    }
  });

  const afterRepoChange = async (label: string) => {
    repoTree?.refresh();
    if (!repoSyncSettings().autoPush) return;
    if (!writeAllowed(getSettings())) return;
    await sync?.pushNow();
    vscode.window.setStatusBarMessage(`$(cloud-upload) ${label}`, 4000);
  };

  reg("queracode.repoNewLesson", async (node?: any) => {
    const found = await requireRepo();
    if (!found) return;
    const chapter = node?.localPath
      ? found.config.chapters.find((c) => c.local_path === node.localPath)
      : await pickRepoChapter(found.config, "درسنامهٔ جدید در کدام فصل؟");
    if (!chapter) return;
    const title = await vscode.window.showInputBox({
      title: `درسنامهٔ جدید در «${chapter.name}»`,
      prompt: "عنوان درسنامه — همین متن سرتیتر اول می‌شود و کلید همگام‌سازی است.",
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : "عنوان لازم است"),
    });
    if (!title?.trim()) return;
    try {
      const { file } = await createLesson(found.root, found.config, chapter.local_path, title.trim());
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await vscode.window.showTextDocument(doc, { preview: false });
      await afterRepoChange(`«${title.trim()}» ساخته شد`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "New درسنامه"));
    }
  });

  reg("queracode.repoNewChapter", async () => {
    const found = await requireRepo();
    if (!found) return;
    const name = await vscode.window.showInputBox({
      title: "فصل جدید",
      prompt: "نام فصل، همان‌طور که در کالج دیده می‌شود",
      ignoreFocusOut: true,
      validateInput: (v) => {
        if (!v.trim()) return "نام لازم است";
        if (found.config.chapters.some((c) => c.name === v.trim())) return "فصلی با همین نام هست";
        return undefined;
      },
    });
    if (!name?.trim()) return;
    try {
      await addChapter(found.root, found.config, name.trim());
      await afterRepoChange(`فصل «${name.trim()}» اضافه شد`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "New chapter"));
    }
  });

  reg("queracode.repoRenameLesson", async (node?: any) => {
    const found = await requireRepo();
    if (!found || !node?.lesson) return;
    const current = path.basename(node.lesson.dir);
    const folder = await vscode.window.showInputBox({
      title: `تغییر نام پوشهٔ «${node.lesson.title}»`,
      prompt: "نام پوشه — عنوان درسنامه دست‌نخورده می‌ماند، چون کلید همگام‌سازی است.",
      value: current, ignoreFocusOut: true,
      validateInput: (v) => (/^[\w.-]+$/.test(v.trim()) ? undefined : "فقط حروف لاتین، عدد، خط تیره و زیرخط"),
    });
    if (!folder?.trim() || folder.trim() === current) return;
    try {
      const base = path.join(found.root, found.config.source.root, path.dirname(node.lesson.dir));
      await renameLessonFolder(path.join(base, current), path.join(base, folder.trim()));
      await afterRepoChange(`پوشه به «${folder.trim()}» تغییر کرد`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Rename"));
    }
  });

  reg("queracode.repoDeleteLesson", async (node?: any) => {
    const found = await requireRepo();
    if (!found || !node?.lesson) return;
    const template = found.config.deleted_lesson?.title_template || "DELETED LESSON - {title}";
    const ok = await vscode.window.showWarningMessage(
      `حذف «${node.lesson.title}» از مخزن؟`,
      {
        modal: true,
        detail: `پوشهٔ ${node.lesson.dir} حذف می‌شود. پس از انتشار، کوئرا این درسنامه را به ` +
          `«${template.replace("{title}", node.lesson.title)}» تغییر نام می‌دهد؛ حذف کامل نمی‌شود.`,
      },
      "حذف"
    );
    if (ok !== "حذف") return;
    try {
      await deleteLessonFolder(path.join(found.root, found.config.source.root, node.lesson.dir));
      await afterRepoChange(`«${node.lesson.title}» حذف شد`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Delete"));
    }
  });

  reg("queracode.repoRevealLesson", async (node?: any) => {
    if (!node?.file) return;
    await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(node.file));
  });

  const pickRepoChapter = async (config: SyncConfig, title: string) => {
    const picked = await vscode.window.showQuickPick(
      config.chapters.map((c) => ({ label: c.name, description: c.local_path, chapter: c })),
      { title, matchOnDescription: true, ignoreFocusOut: true });
    return (picked as any)?.chapter as SyncConfig["chapters"][number] | undefined;
  };

  const pickers = service ? makePickers(service) : undefined;

  const activeMarkdown = (): string | undefined => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      vscode.window.showWarningMessage("یک فایل Markdown را باز کنید.");
      return undefined;
    }
    return editor.document.uri.fsPath;
  };

  reg("queracode.bindFile", async (arg?: any) => {
    if (!service || !direct) return;
    const file = arg?.file || arg?.fsPath || activeMarkdown();
    if (!file) return;
    const root = await bindingRoot(file);
    if (!root) return;

    const target = await pickPublishTarget();
    if (!target) return;
    await setBinding(root, file, target);
    repoTree?.refresh();
    const go = await vscode.window.showInformationMessage(
      `«${path.basename(file)}» به «${target.title ?? `#${target.itemId}`}» وصل شد.`,
      "دریافت از کوئرا", "انتشار همین حالا");
    if (go === "دریافت از کوئرا") await direct.pull(file);
    if (go === "انتشار همین حالا") await direct.push(file);
  });

  reg("queracode.unbindFile", async () => {
    const file = activeMarkdown();
    if (!file) return;
    const root = await bindingRoot(file);
    if (!root) return;
    const removed = await removeBinding(root, file);
    vscode.window.showInformationMessage(removed
      ? `اتصال «${path.basename(file)}» برداشته شد.`
      : `«${path.basename(file)}» اتصالی نداشت.`);
    repoTree?.refresh();
  });

  reg("queracode.publishFile", async (arg?: any) => {
    if (!direct) return;
    const file = arg?.file || arg?.fsPath || activeMarkdown();
    if (file) await direct.push(file);
  });

  reg("queracode.pullFile", async (arg?: any) => {
    if (!direct) return;
    const file = arg?.file || arg?.fsPath || activeMarkdown();
    if (file) await direct.pull(file);
  });

  reg("queracode.showBinding", async () => {
    const file = activeMarkdown();
    if (!file) return;
    const root = await bindingRoot(file);
    const binding = root ? await getBinding(root, file) : undefined;
    if (!binding) {
      const pick = await vscode.window.showInformationMessage(
        `«${path.basename(file)}» به کوئرا وصل نیست.`, "اتصال…");
      if (pick) await vscode.commands.executeCommand("queracode.bindFile");
      return;
    }
    const when = (iso?: string) => (iso ? faDateTime(iso) : "—");
    await vscode.window.showInformationMessage(
      `«${binding.title ?? `#${binding.itemId}`}» · ${binding.kind === "lesson" ? "درسنامه" : "تمرین"} ` +
        `در ${binding.area} #${binding.chapterId}`,
      { modal: true, detail: `آخرین انتشار: ${when(binding.publishedAt)}\nآخرین دریافت: ${when(binding.pulledAt)}` },
      "باشه");
  });

  const pickPublishTarget = async (): Promise<Binding | undefined> => {
    if (!pickers) return undefined;
    const target = await pickers.pickChapterInteractively();
    if (!target) return undefined;
    const item = await pickers.pickItem(target, "به کدام درسنامه یا تمرین وصل شود؟");
    if (!item) return undefined;
    return {
      kind: item.score === undefined ? "lesson" : "problem",
      chapterId: target.aid,
      itemId: item.id,
      area: target.area,
      collegeId: target.collegeId,
      title: item.name,
    };
  };

  reg("queracode.importCollegeIntoRepo", async () => {
    if (!service || !direct) return;
    const found = await requireRepo();
    if (!found) return;
    const overwrite = await vscode.window.showQuickPick(
      [
        { label: "فقط موارد تازه", detail: "درسنامه‌های موجود در مخزن دست‌نخورده می‌مانند.", value: false },
        { label: "بازنویسی همه", detail: "محتوای محلی با نسخهٔ کوئرا جایگزین می‌شود.", value: true },
      ],
      { title: "دریافت کالج در مخزن", ignoreFocusOut: true });
    if (!overwrite) return;
    try {
      const client = await service.getClient();
      const user = await client.whoami();
      const colleges = (user?.my_colleges || []).map((c: any) => {
        const m = String(c.url || "").match(/college\/(?:land\/college\/|landpage\/)?(\d+)(?:\/([^/?#]+))?/);
        return { id: Number(c.pk ?? c.id ?? m?.[1]), name: c.name, slug: m?.[2] };
      }).filter((c: any) => Number.isFinite(c.id));
      const preferred = colleges.find((c: any) => c.id === found.config.college.college_id) ?? colleges[0];
      const picked = colleges.length > 1
        ? await vscode.window.showQuickPick(
            colleges.map((c: any) => ({ label: c.name, description: `#${c.id}`, college: c })),
            { title: "کدام کالج؟", ignoreFocusOut: true })
        : { college: preferred } as any;
      const college = picked?.college;
      if (!college) return;
      const result = await direct.importCollege(
        found.root, found.config, college.id, college.slug, { overwrite: (overwrite as any).value });
      repoTree?.refresh();
      await afterRepoChange(
        `${faNum(result.created)} تازه · ${faNum(result.updated)} به‌روز · ${faNum(result.skipped)} رد‌شده`);
      vscode.window.showInformationMessage(
        `دریافت کامل شد — ${faNum(result.created)} درسنامهٔ تازه، ${faNum(result.updated)} به‌روزرسانی، ${faNum(result.skipped)} رد‌شده.`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Import college"));
    }
  });

  reg("queracode.repoSyncNow", async () => {
    if (!sync) return;
    await sync.pushNow();
  });

  reg("queracode.repoPullNow", async () => {
    if (!sync) return;
    await sync.autoPull(false);
  });

  const requireRepo = async (): Promise<{ root: string; config: SyncConfig } | undefined> => {
    const found = await findSyncRepo(
      (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath));
    if (!found) {
      const pick = await vscode.window.showWarningMessage(
        `No Quera course repo in this workspace (looked for ${SYNC_CONFIG}).`,
        "Clone one", "Link a college", "Cancel");
      if (pick === "Clone one") await vscode.commands.executeCommand("queracode.repoClone");
      if (pick === "Link a college") await vscode.commands.executeCommand("queracode.repoLink");
      return undefined;
    }
    if (!(await isGitRepo(found.root))) {
      const pick = await vscode.window.showWarningMessage(
        `«${path.basename(found.root)}» has a Quera sync config but is not a Git repository yet, ` +
          "so there is nothing to pull or push.",
        "Initialize now", "Cancel");
      if (pick !== "Initialize now") return undefined;
      const remote = await vscode.window.showInputBox({
        title: "Remote URL (optional)",
        prompt: "git@github.com:you/your-course.git — leave blank to add it later",
        ignoreFocusOut: true,
      });
      await initRepo(found.root, remote?.trim() || undefined);
      vscode.window.showInformationMessage(`Initialized a Git repository in «${path.basename(found.root)}».`);
    }
    return found;
  };

  reg("queracode.repoClone", async () => {
    const url = await vscode.window.showInputBox({
      title: "Clone a Quera course repository",
      prompt: "Git URL (SSH or HTTPS)",
      placeHolder: "git@github.com:you/your-course.git",
      validateInput: (v) => (v.trim() ? undefined : "A Git URL is required"),
    });
    if (!url) return;
    const target = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
      openLabel: "Clone here",
    });
    if (!target?.length) return;
    try {
      const dir = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Cloning ${url}…` },
        () => cloneRepo(url.trim(), target[0].fsPath));
      const open = await vscode.window.showInformationMessage(
        `Cloned to ${dir}.`, "Open folder", "Later");
      if (open === "Open folder") {
        await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(dir), true);
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Clone"));
    }
  });

  reg("queracode.repoPull", async () => {
    const repo = await requireRepo();
    if (!repo) return;
    try {
      const out = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Pulling course repo…" },
        () => pullRepo(repo.root));
      vscode.window.showInformationMessage(out || "Already up to date.");
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Pull"));
    }
  });

  reg("queracode.repoStatus", async () => {
    const repo = await requireRepo();
    if (!repo) return;
    try {
      const [status, lessons] = await Promise.all([
        repoStatus(repo.root),
        collectLessons(repo.root, repo.config),
      ]);
      const rows = lessons.map((l) => `| ${l.title} | ${l.chapter} | \`${l.dir}\` |`);
      showPreview("Quera course repo", [
        `# ${path.basename(repo.root)}`,
        "",
        `- college: \`${repo.config.college.college_id}\``,
        `- branch: \`${status.branch}\` (${status.ahead} ahead, ${status.behind} behind)`,
        `- uncommitted files: ${status.dirty.length}`,
        `- lessons found: ${lessons.length}`,
        "",
        "| lesson | chapter | folder |",
        "| --- | --- | --- |",
        ...rows,
        "",
        status.dirty.length
          ? "> Run **Quera: Push Course Repo** to publish — the repo's GitHub Actions sync republishes changed lessons on push."
          : "> Nothing to publish: the working tree is clean.",
      ].join("\n"));
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Status"));
    }
  });

  reg("queracode.repoPush", async () => {
    const repo = await requireRepo();
    if (!repo) return;
    const cwd = repo.root;
    try {
      const status = await repoStatus(cwd);
      if (!status.dirty.length && !status.ahead) {
        vscode.window.showInformationMessage("Nothing to push — the working tree is clean.");
        return;
      }
      const message = await vscode.window.showInputBox({
        title: "Commit message",
        value: `Update lessons (${status.dirty.length} changed)`,
        validateInput: (v) => (v.trim() ? undefined : "A commit message is required"),
      });
      if (!message) return;
      const ok = await vscode.window.showWarningMessage(
        `Push ${status.dirty.length} change(s) to '${status.branch}'? ` +
        `This triggers the Quera sync, which publishes changed lessons to college ` +
        `${repo.config.college.college_id}.`,
        { modal: true }, "Push & publish");
      if (ok !== "Push & publish") return;
      const branch = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Committing and pushing…" },
        () => commitAndPush(cwd, message.trim()));
      vscode.window.showInformationMessage(
        branch
          ? `Pushed to '${branch}'. The Quera sync workflow publishes changed lessons.`
          : "Nothing to commit.");
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Push"));
    }
  });
}

export type Area = "course" | "college" | "contest";
export interface Target { aid: number; area: Area; collegeId?: number }

function makePickers(service: QueraService) {

  const ensureWrite = async (): Promise<boolean> => {
    const s = getSettings();
    if (writeAllowed(s)) return true;
    const pick = await vscode.window.showWarningMessage(
      "Editing Quera content is disabled ('queracode.enableWrite' is off — it defaults to off so nothing is changed by accident).",
      "Enable now", "Cancel");
    if (pick !== "Enable now") return false;
    await vscode.workspace.getConfiguration("queracode").update("enableWrite", true, true);
    service.fire();
    return true;
  };

  const askTarget = async (node: any): Promise<Target | undefined> => {
    const fromNode = Number(node?.chapterId ?? node?.assignmentId);
    if (Number.isFinite(fromNode) && fromNode > 0) {
      const area: Area = node?.collegeId ? "college" : (node?.area || "course");
      return { aid: fromNode, area, collegeId: Number(node?.collegeId) || undefined };
    }
    return pickChapterInteractively();
  };

  const pickChapterInteractively = async (): Promise<Target | undefined> => {
    type Choice = { label: string; description?: string; detail?: string; pick: "college" | "class" | "manual"; id?: number; slug?: string };
    let roots: Choice[];
    try {
      roots = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Loading your colleges and classes…" },
        async (): Promise<Choice[]> => {
          const client = await service.getClient();
          const [dash, classes] = await Promise.all([
            client.getDashboard().catch(() => ({ colleges: [], data: {} } as any)),
            client.getClasses().catch(() => ({ items: [] } as any)),
          ]);
          const colleges: any[] = dash.colleges?.length ? dash.colleges : dash.data?.latest_colleges || [];
          return [
            ...colleges.map((c: any): Choice => ({
              label: `$(mortar-board) ${c.name}`, description: `کالج #${c.id}`,
              pick: "college", id: Number(c.id), slug: c.slug,
            })),
            ...(classes.items || []).map((c: any): Choice => ({
              label: `$(book) ${c.name}`, description: `کلاس #${c.id}`,
              detail: c.instructor || undefined, pick: "class", id: Number(c.id),
            })),
          ];
        }
      );
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "List your courses"));
      roots = [];
    }
    roots.push({ label: "$(edit) Enter an assignment id or URL…", pick: "manual" });

    const root = await vscode.window.showQuickPick(roots, {
      title: "Which course does the chapter belong to?",
      matchOnDescription: true, ignoreFocusOut: true,
    });
    if (!root) return undefined;

    if (root.pick === "manual") {
      const idStr = await vscode.window.showInputBox({
        title: "Assignment / chapter id",
        prompt: "Numeric id, or a Quera assignment URL",
        ignoreFocusOut: true,
        validateInput: (v) => (/\d/.test(v) ? undefined : "Enter a numeric id or a Quera URL"),
      });
      if (!idStr) return undefined;
      const aid = Number(idStr.match(/assignments\/(\d+)/)?.[1] ?? idStr.trim());
      if (!Number.isFinite(aid) || aid <= 0) return undefined;
      const area = (await vscode.window.showQuickPick(["course", "college", "contest"], {
        title: "Where does this assignment live?", ignoreFocusOut: true,
      })) as Area | undefined;
      return area ? { aid, area } : undefined;
    }

    try {
      const client = await service.getClient();
      const chapters = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Loading chapters of «${root.label.replace(/^\$\([^)]*\)\s*/, "")}»…` },
        async () => {
          if (root.pick === "college") {
            const res = await client.getCollegeChapters(root.id!, root.slug);
            return (res.chapters || []).map((ch: any) => ({
              id: Number(ch.id ?? ch.pk),
              name: String(ch.name ?? ch.title ?? `#${ch.id}`),
              count: (ch.items || ch.problems || ch.lessons || []).length,
            }));
          }
          const course: any = await client.getCourse(root.id!);
          return (course.assignments || course.chapters || []).map((ch: any) => ({
            id: Number(ch.pk ?? ch.id),
            name: String(ch.name ?? ch.title ?? `#${ch.pk ?? ch.id}`),
            count: Number(ch.problem_count ?? (ch.problems || []).length) || 0,
          }));
        }
      );
      const valid = chapters.filter((c: any) => Number.isFinite(c.id) && c.id > 0);
      if (!valid.length) {
        vscode.window.showWarningMessage(
          `«${root.label.replace(/^\$\([^)]*\)\s*/, "")}» reported no chapters you can write to.`);
        return undefined;
      }
      const chapter = await vscode.window.showQuickPick(
        valid.map((c: any) => ({
          label: c.name,
          description: `#${c.id}${c.count ? ` · ${c.count} مورد` : ""}`,
          id: c.id,
        })),
        { title: "Which chapter should it go into?", matchOnDescription: true, ignoreFocusOut: true }
      );
      if (!chapter) return undefined;
      return {
        aid: (chapter as any).id,
        area: root.pick === "college" ? "college" : "course",
        collegeId: root.pick === "college" ? root.id : undefined,
      };
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "List chapters"));
      return undefined;
    }
  };

  const pickItem = async (target: Target, placeHolder: string) => {
    const client = await service.getClient();
    let items: { id: number; name: string; score?: number }[] = [];
    let emptyReason: string | undefined;
    if (target.area === "college" && target.collegeId) {
      const tree = await client.getCollegeChapters(target.collegeId);
      items = tree.chapters.find((ch) => ch.id === target.aid)?.items ?? [];
    } else {
      const res = await client.listAssignmentContents(
        target.aid, target.area === "contest" ? "contest" : "course");
      items = res.items;
      emptyReason = res.emptyReason;
    }
    if (!items.length) {
      vscode.window.showWarningMessage(
        emptyReason ||
          (target.area === "college" && !target.collegeId
            ? `Chapter ${target.aid} is a college chapter — reopen it from the Courses view so QueraCode knows which college it belongs to.`
            : `Assignment ${target.aid} has no problems or lessons.`));
      return undefined;
    }
    const choice = await vscode.window.showQuickPick(
      items.map((i) => ({
        label: i.name,
        description: `#${i.id}${i.score !== undefined ? ` · ${i.score} pts` : " · درسنامه"}`,
        item: i,
      })),
      { title: placeHolder, ignoreFocusOut: true });
    return (choice as any)?.item as { id: number; name: string; score?: number } | undefined;
  };


  return { askTarget, ensureWrite, pickChapterInteractively, pickItem };
}

export function registerAuthoringCommands(
  context: vscode.ExtensionContext,
  service: QueraService,
  providers: Providers
): void {
  assignmentEditMap.attach(context.workspaceState);
  const { askTarget, ensureWrite, pickItem } = makePickers(service);
  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  const addItem = async (node: any, kind: "lesson" | "problem") => {
    if (!(await ensureWrite())) return;
    const target = await askTarget(node);
    if (!target) return;
    const name = await vscode.window.showInputBox({
      title: kind === "lesson" ? "New درسنامه title" : "New problem title",
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : "A title is required"),
    });
    if (!name) return;

    let score = 0;
    let allowedFileTypeIds: number[] | undefined;
    if (kind === "problem") {
      const scoreStr = await vscode.window.showInputBox({
        title: "Score", value: "100", ignoreFocusOut: true,
        validateInput: (v) => (/^\d+$/.test(v.trim()) ? undefined : "Whole number"),
      });
      if (scoreStr === undefined) return;
      score = Number(scoreStr);
      const langs = await vscode.window.showQuickPick(
        LANGUAGES.filter((l) => resolveFileTypeId("J", l.key) !== undefined)
          .map((l) => ({ label: l.label || l.key, key: l.key,
                         picked: l.key === getSettings().defaultLanguage })),
        { title: "Languages students may submit (required)", canPickMany: true, ignoreFocusOut: true });
      const chosen = (langs as any[]) || [];
      if (!chosen.length) {
        vscode.window.showWarningMessage("No language selected — the problem would accept no submissions.");
        return;
      }
      allowedFileTypeIds = chosen
        .map((c) => resolveFileTypeId("J", c.key))
        .filter((id): id is number => id !== undefined);
    }

    const body = kind === "lesson"
      ? `# ${name}\n\nمتن درسنامه را اینجا بنویسید.\n`
      : PROBLEM_SKELETON.replace(/^# .*$/m, `# ${name}`);
    try {
      const client = await service.getClient();
      const before = await client.listAssignmentItems(
        target.aid, target.area === "contest" ? "contest" : "course");
      const seen = new Set(before.map((i) => i.id));
      const res = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Creating «${name}»…` },
        () => client.addAssignmentProblem(target.aid, {
          area: target.area, name, description: body,
          score: kind === "lesson" ? 0 : score,
          type: kind === "lesson" ? "F" : "J",
          timeLimitMs: kind === "problem" ? 1000 : undefined,
          memoryLimitMb: kind === "problem" ? 256 : undefined,
          allowedFileTypeIds,
        }));
      const after = await client.listAssignmentItems(
        target.aid, target.area === "contest" ? "contest" : "course");
      const created = after.find((i) => !seen.has(i.id));
      providers.courses.refresh();
      if (created) {
        vscode.window.showInformationMessage(`Created «${created.name}» (#${created.id}).`);
        const open = await vscode.window.showInformationMessage(
          "Open it for editing?", "Open", "Later");
        if (open === "Open") {
          await vscode.commands.executeCommand(
            "queracode.editAssignmentProblem",
            { chapterId: target.aid, area: target.area, problemId: created.id });
        }
      } else {
        vscode.window.showWarningMessage(
          `Quera accepted the request (HTTP ${res.status}) but no new item appeared — you may lack staff permission on assignment ${target.aid}.`);
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Create"));
    }
  };

  reg("queracode.addLessonToAssignment", (node: any) => addItem(node, "lesson"));
  reg("queracode.addProblemToAssignment", (node: any) => addItem(node, "problem"));

  reg("queracode.editAssignmentProblem", async (node: any) => {
    if (!(await ensureWrite())) return;
    const target = await askTarget(node);
    if (!target) return;
    try {
      const client = await service.getClient();
      let problemId = Number(node?.problemId ?? node?.lessonId);
      if (!Number.isFinite(problemId) || problemId <= 0) {
        const picked = await pickItem(target, "Which item do you want to edit?");
        if (!picked) return;
        problemId = picked.id;
      }
      const detail = await client.getAssignmentProblem(
        target.aid, problemId, target.area === "contest" ? "contest" : "course");
      const dir = await solutionsRoot("edits");
      const file = vscode.Uri.joinPath(dir, `${target.area}-${target.aid}-${problemId}.md`);
      await vscode.workspace.fs.writeFile(file, Buffer.from(detail.description || ""));
      const doc = await vscode.workspace.openTextDocument(file);
      await vscode.window.showTextDocument(doc, { preview: false });
      assignmentEditMap.set(doc.uri.fsPath, {
        aid: target.aid, area: target.area, problemId, name: detail.name || `#${problemId}` });
      lenses.refresh();
      vscode.window.showInformationMessage(
        `Editing «${detail.name}». Use the “Publish to Quera” action at the top of the file when you are done.`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Edit"));
    }
  });

  reg("queracode.publishAssignmentEdit", async () => {
    if (!(await ensureWrite())) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (editor.document.isDirty) await editor.document.save();
    const ctx = assignmentEditMap.get(editor.document.uri.fsPath);
    if (!ctx) {
      vscode.window.showWarningMessage(
        "This document was not opened with 'Quera: Edit Assignment Problem', so its target is unknown.");
      return;
    }
    const ok = await vscode.window.showWarningMessage(
      `Publish your changes to «${ctx.name}» (#${ctx.problemId})?`, { modal: true }, "Publish");
    if (ok !== "Publish") return;
    try {
      const client = await service.getClient();
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Publishing «${ctx.name}»…` },
        () => client.updateAssignmentProblem(ctx.aid, ctx.problemId, {
          area: ctx.area, description: editor.document.getText() }));
      const after = await client.getAssignmentProblem(
        ctx.aid, ctx.problemId, ctx.area === "contest" ? "contest" : "course");
      const landed = (after.description || "").trim() === editor.document.getText().trim();
      vscode.window.showInformationMessage(
        landed ? `Published «${ctx.name}».`
               : `Quera accepted the edit for «${ctx.name}», but the stored text differs — re-open it to check.`);
      providers.courses.refresh();
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Publish"));
    }
  });

  reg("queracode.deleteAssignmentProblem", async (node: any) => {
    if (!(await ensureWrite())) return;
    const target = await askTarget(node);
    if (!target) return;
    try {
      const client = await service.getClient();
      let item: { id: number; name: string } | undefined;
      const nodeId = Number(node?.problemId ?? node?.lessonId);
      if (Number.isFinite(nodeId) && nodeId > 0) {
        const items = await client.listAssignmentItems(
          target.aid, target.area === "contest" ? "contest" : "course");
        item = items.find((i) => i.id === nodeId);
      }
      if (!item) item = await pickItem(target, "Which item do you want to DELETE?");
      if (!item) return;

      const typed = await vscode.window.showInputBox({
        title: `Delete «${item.name}» (#${item.id})`,
        prompt: `This also deletes its submissions and CANNOT be undone. Type the name to confirm.`,
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() === item!.name ? undefined : "Type the exact name to confirm"),
      });
      if (typed?.trim() !== item.name) return;

      await client.deleteAssignmentProblem(item.id);
      const after = await client.listAssignmentItems(
        target.aid, target.area === "contest" ? "contest" : "course");
      providers.courses.refresh();
      vscode.window.showInformationMessage(
        after.some((i) => i.id === item!.id)
          ? `Quera did not remove «${item.name}» — you may lack permission.`
          : `Deleted «${item.name}».`);
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Delete"));
    }
  });

  reg("queracode.reorderAssignmentProblems", async (node: any) => {
    if (!(await ensureWrite())) return;
    const target = await askTarget(node);
    if (!target) return;
    try {
      const client = await service.getClient();
      const area = target.area === "contest" ? "contest" : "course";
      const items = await client.listAssignmentItems(target.aid, area);
      if (items.length < 2) {
        vscode.window.showInformationMessage("Nothing to reorder — fewer than two items.");
        return;
      }
      const picked = await vscode.window.showQuickPick(
        items.map((i) => ({ label: i.name, description: `#${i.id}`, id: i.id })),
        { title: "Pick items in the order you want them", canPickMany: true, ignoreFocusOut: true });
      const chosen = ((picked as any[]) || []).map((p) => p.id);
      if (!chosen.length) return;
      const ordered = [...chosen, ...items.map((i) => i.id).filter((id) => !chosen.includes(id))];
      await client.reorderAssignmentProblems(target.aid, ordered);
      const after = await client.listAssignmentItems(target.aid, area);
      providers.courses.refresh();
      const applied = after.map((i) => i.id).join(",") === ordered.join(",");
      vscode.window.showInformationMessage(
        applied ? "Order updated." : "Quera stored a different order — refresh to see what it kept.");
    } catch (e: any) {
      vscode.window.showErrorMessage(explainError(e, "Reorder"));
    }
  });
}
