import * as vscode from "vscode";


interface ToolEntry {
  label: string;
  command: string;
  icon: string;
  detail: string;
}

const GROUPS: { label: string; icon: string; tools: ToolEntry[] }[] = [
  {
    label: "Solve & Submit",
    icon: "rocket",
    tools: [
      { label: "Dashboard", command: "queracode.openDashboard", icon: "dashboard", detail: "your Quera home (Ctrl+Alt+D)" },
      { label: "Open Problem by URL", command: "queracode.openProblemByUrl", icon: "link-external", detail: "problemset / course / contest URLs" },
      { label: "Search Problems", command: "queracode.searchProblems", icon: "search", detail: "Ctrl+Alt+P" },
      { label: "Set Filters", command: "queracode.setFilters", icon: "filter", detail: "difficulty, tags, category, …" },
      { label: "Quick Submit (any file → URL)", command: "queracode.quickSubmit", icon: "cloud-upload", detail: "Ctrl+Alt+U" },
      { label: "Run on Samples", command: "queracode.runSamples", icon: "play", detail: "statement + custom tests (Ctrl+Alt+R)" },
      { label: "Add Custom Test", command: "queracode.addCustomTest", icon: "beaker", detail: "your own input/output (Ctrl+Alt+T)" },
      { label: "Save Problem Locally", command: "queracode.saveProblem", icon: "save", detail: "statement + meta + sample tests" },
      { label: "Send to CPH", command: "queracode.sendToCph", icon: "broadcast", detail: "Competitive Companion (port 27121)" },
      { label: "Setup CP Library", command: "queracode.setupCpLibrary", icon: "library", detail: "AtCoder Library, KACTL, testlib, …" },
    ],
  },
  {
    label: "Authoring",
    icon: "edit",
    tools: [
      { label: "New Lesson (Markdown)", command: "queracode.newLesson", icon: "add", detail: "درسنامه skeleton" },
      { label: "New Problem (scaffold)", command: "queracode.newProblem", icon: "new-folder", detail: "judge + init + solution layout" },
      { label: "Edit Lesson", command: "queracode.editLesson", icon: "edit", detail: "load a lesson's Markdown (staff)" },
      { label: "Publish Lesson ⚠", command: "queracode.publishLesson", icon: "cloud-upload", detail: "lint → confirm → publish (gated)" },
      { label: "Preview (RTL + Persian)", command: "queracode.previewMarkdown", icon: "preview", detail: "interactive: copy, ToC, dir, size (Ctrl+Alt+V)" },
      { label: "Insert Macro", command: "queracode.insertMacro", icon: "symbol-operator", detail: "%problem.X% / %video.X%" },
      { label: "Insert CP Template", command: "queracode.insertTemplate", icon: "symbol-snippet", detail: "DSU, Dijkstra, sieve, …" },
      { label: "Snapshot Version", command: "queracode.snapshotVersion", icon: "history", detail: "manual save point" },
      { label: "Version History", command: "queracode.versionHistory", icon: "history", detail: "diff / restore (Ctrl+Alt+H)" },
    ],
  },
  {
    label: "Tests & Judges",
    icon: "beaker",
    tools: [
      { label: "Auto-Generate Tests", command: "queracode.autoGenerateTests", icon: "run-all", detail: "inputs → your solution → in/out files, one click" },
      { label: "Publish to Assignment (URL)", command: "queracode.publishToAssignment", icon: "cloud-upload", detail: "درسنامه / تمرین + جاج + init به یک تمرین LMS" },
      { label: "Init Project Judge", command: "queracode.initJudge", icon: "law", detail: "Python / DevOps / Jest / Cypress / Django scaffolds" },
      { label: "Generate tester_config from tests", command: "queracode.generateTesterConfig", icon: "json", detail: "counts + groups your test functions" },
      { label: "Generate valid_files", command: "queracode.generateValidFiles", icon: "checklist", detail: "every path a user may upload" },
      { label: "Generate Test Inputs", command: "queracode.generateTestInputs", icon: "beaker", detail: "seeded arrays/graphs/strings" },
      { label: "Build Test Bundle (problem.zip)", command: "queracode.buildTestBundle", icon: "package", detail: "in/ + out/ + tester.cpp + zip" },
      { label: "Validate Test Bundle", command: "queracode.validateTestBundle", icon: "checklist", detail: "naming, pairing, numbering" },
      { label: "Insert tester.cpp", command: "queracode.insertTesterCpp", icon: "file-code", detail: "special-judge scaffold" },
      { label: "Validate Judge (tester_config)", command: "queracode.validateJudge", icon: "law", detail: "score sum, tests, aggregators (Ctrl+Alt+J)" },
      { label: "Validate Test Names", command: "queracode.validateTestNames", icon: "beaker", detail: "English, descriptive names" },
      { label: "Validate DevOps Image", command: "queracode.validateDevopsImage", icon: "server", detail: "qregistry whitelist" },
    ],
  },
  {
    label: "Text & Markdown",
    icon: "markdown",
    tools: [
      { label: "Validate Markdown", command: "queracode.validateMarkdown", icon: "check", detail: "the Quera dialect linter" },
      { label: "Normalize Persian", command: "queracode.normalizePersian", icon: "symbol-string", detail: "ZWNJ / Arabic letters" },
    ],
  },
  {
    label: "AI & Agents",
    icon: "sparkle",
    tools: [
      { label: "Configure AI Provider", command: "queracode.ai.configure", icon: "gear", detail: "OpenRouter, Ollama, … (key in SecretStorage)" },
      { label: "AI: Generate Solution", command: "queracode.ai.generateSolution", icon: "sparkle", detail: "drafts code — never submits" },
      { label: "AI: Explain Problem", command: "queracode.ai.explainProblem", icon: "sparkle", detail: "learner-friendly brief" },
      { label: "AI: Review Submission", command: "queracode.ai.reviewSubmission", icon: "sparkle", detail: "verdict + log + code → diagnosis" },
      { label: "AI: Chat", command: "queracode.ai.chat", icon: "comment-discussion", detail: "free-form prompt" },
      { label: "Solve with Claude Code", command: "queracode.solveWithClaudeCode", icon: "terminal", detail: "hands the problem to `claude` in a terminal" },
      { label: "Register QueraMCP for Agents", command: "queracode.registerMcp", icon: "server-process", detail: "optional sibling-server wiring" },
    ],
  },
  {
    label: "Account",
    icon: "account",
    tools: [
      { label: "Sign In", command: "queracode.login", icon: "sign-in", detail: "session id or username/password" },
      { label: "Who Am I", command: "queracode.whoami", icon: "person", detail: "verify the session" },
      { label: "Sign Out", command: "queracode.logout", icon: "sign-out", detail: "clear SecretStorage" },
      { label: "Refresh All", command: "queracode.refresh", icon: "refresh", detail: "reload every view" },
    ],
  },
];

class GroupNode extends vscode.TreeItem {
  constructor(public readonly group: (typeof GROUPS)[number]) {
    super(group.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon(group.icon);
    this.contextValue = "toolGroup";
  }
}

export class ToolsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(el: vscode.TreeItem): vscode.TreeItem {
    return el;
  }
  getChildren(el?: vscode.TreeItem): vscode.TreeItem[] {
    if (!el) return GROUPS.map((g) => new GroupNode(g));
    if (el instanceof GroupNode) {
      return el.group.tools.map((t) => {
        const item = new vscode.TreeItem(t.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(t.icon);
        item.description = t.detail;
        item.command = { command: t.command, title: t.label };
        return item;
      });
    }
    return [];
  }
}
