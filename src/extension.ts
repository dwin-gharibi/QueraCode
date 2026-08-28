import * as vscode from "vscode";
import { QueraService } from "./service";
import { ProblemsetProvider } from "./tree/problemsetProvider";
import { CoursesProvider } from "./tree/coursesProvider";
import { SubmissionsProvider } from "./tree/submissionsProvider";
import { ContestsProvider } from "./tree/contestsProvider";
import { ToolsProvider } from "./tree/toolsProvider";
import { LibraryProvider } from "./tree/libraryProvider";
import { RepoProvider } from "./tree/repoProvider";
import { assignmentTargetFor, registerAuthoringCommands, registerCommands, registerRepoCommands, setLensProvider } from "./commands";
import { buildApi, registerMcpServer, QueraCodeApi } from "./agent";
import { QueraLensProvider } from "./codelens";
import { openDashboard } from "./panels/dashboard";
import { showWelcome, showWelcomeOnce } from "./panels/welcome";
import { showSettings, watchSettings } from "./panels/settings";
import { setQueraBase } from "./panels/render";
import { RepoSync } from "./repoSync";
import { DirectSync } from "./directSync";
import { setExtensionUri, setGlobalState } from "./panels/webviewEnv";

export async function activate(context: vscode.ExtensionContext): Promise<QueraCodeApi> {
  setExtensionUri(context.extensionUri);
  setGlobalState(context.globalState);
  const service = new QueraService(context);
  setQueraBase(service.settings().baseUrl);

  const problemset = new ProblemsetProvider(service);
  const courses = new CoursesProvider(service);
  const submissions = new SubmissionsProvider();
  const contests = new ContestsProvider(service);
  const tools = new ToolsProvider();
  const library = new LibraryProvider();
  const repoTree = new RepoProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("queracode.problemset", problemset),
    vscode.window.registerTreeDataProvider("queracode.courses", courses),
    vscode.window.registerTreeDataProvider("queracode.contests", contests),
    vscode.window.registerTreeDataProvider("queracode.submissions", submissions),
    vscode.window.registerTreeDataProvider("queracode.library", library),
    vscode.window.registerTreeDataProvider("queracode.tools", tools),
    vscode.window.registerTreeDataProvider("queracode.repo", repoTree)
  );
  const libWatcher = vscode.workspace.createFileSystemWatcher("**/quera/**");
  libWatcher.onDidCreate(() => library.refresh());
  libWatcher.onDidDelete(() => library.refresh());
  context.subscriptions.push(libWatcher);

  registerCommands(context, service, { problemset, courses, submissions });
  const repoSync = new RepoSync();
  context.subscriptions.push(repoSync);
  void repoSync.discover();
  const directSync = new DirectSync(service);
  context.subscriptions.push(directSync);
  registerRepoCommands(context, service, repoSync, repoTree, directSync);
  const repoWatcher = vscode.workspace.createFileSystemWatcher("**/*.md");
  repoWatcher.onDidCreate(() => repoTree.refresh());
  repoWatcher.onDidDelete(() => repoTree.refresh());
  repoWatcher.onDidChange(() => repoTree.refresh());
  context.subscriptions.push(repoWatcher);
  registerAuthoringCommands(context, service, { problemset, courses, submissions });

  const lenses = new QueraLensProvider(assignmentTargetFor);
  setLensProvider(lenses);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "markdown" }, lenses)
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "queracode.searchProblems";
  status.show();
  context.subscriptions.push(status);
  const sbDashboard = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  sbDashboard.text = "$(dashboard)";
  sbDashboard.tooltip = "Quera Dashboard (Ctrl+Alt+D)";
  sbDashboard.command = "queracode.openDashboard";
  sbDashboard.show();
  const sbSubmit = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  sbSubmit.text = "$(rocket)";
  sbSubmit.tooltip = "Quera: quick submit this file (Ctrl+Alt+U)";
  sbSubmit.command = "queracode.quickSubmit";
  sbSubmit.show();
  const sbOpen = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
  sbOpen.text = "$(link-external)";
  sbOpen.tooltip = "Quera: open a problem by URL or id";
  sbOpen.command = "queracode.openProblemByUrl";
  sbOpen.show();
  context.subscriptions.push(sbDashboard, sbSubmit, sbOpen);

  const refreshStatus = async () => {
    const signedIn = await service.isSignedIn();
    const s = service.settings();
    const gate = s.readOnly ? "read-only" : s.enableSubmission ? "submit on" : "submit off";
    status.text = signedIn ? `$(check) Quera · ${gate}` : "$(sign-in) Quera: sign in";
    status.tooltip = signedIn
      ? `Signed in to Quera (${s.authMethod}). Submission: ${gate}. Click to search problems.`
      : "QueraCode — click to sign in and browse Quera problems.";
    status.command = signedIn ? "queracode.searchProblems" : "queracode.login";
    await vscode.commands.executeCommand("setContext", "queracode.signedIn", signedIn);
  };
  await refreshStatus();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("queracode")) {
      service.fire();
      problemset.refresh();
      courses.refresh();
      refreshStatus();
    }
  }));
  context.subscriptions.push(service.onDidChange(() => refreshStatus()));

  if (service.settings().autoRegisterMcp) {
    registerMcpServer(false).catch(() => undefined);
  }

  const extensionId = context.extension?.id ?? "dwin-gharibi.queracode";
  const version = String(context.extension?.packageJSON?.version ?? "0.0.0");
  context.subscriptions.push(
    vscode.commands.registerCommand("queracode.openWalkthrough", () =>
      vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        `${extensionId}#queracode.getStarted`,
        false
      )
    ),
    vscode.commands.registerCommand("queracode.showWelcome", () => showWelcome(service, version)),
    vscode.commands.registerCommand("queracode.openSettingsPanel", () => showSettings(service)),
    watchSettings(service)
  );
  const welcomed = await showWelcomeOnce(context, service, version);

  if (service.settings().openDashboardOnStartup && !welcomed) {
    openDashboard(service).catch(() => undefined);
  }

  return buildApi(service);
}

export function deactivate(): void {
  /* nothing to clean up */
}
