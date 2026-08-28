import * as path from "path";
import * as nodeFs from "fs";

export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }
export enum FileType { Unknown = 0, File = 1, Directory = 2, SymbolicLink = 64 }
export enum ViewColumn { Active = -1, Beside = -2, One = 1 }
export enum ProgressLocation { SourceControl = 1, Window = 10, Notification = 15 }
export enum StatusBarAlignment { Left = 1, Right = 2 }
export enum ConfigurationTarget { Global = 1, Workspace = 2, WorkspaceFolder = 3 }

export class ThemeIcon {
  constructor(public readonly id: string, public readonly color?: any) {}
}
export class ThemeColor {
  constructor(public readonly id: string) {}
}
export class EventEmitter<T> {
  private listeners: ((e: T) => any)[] = [];
  event = (fn: (e: T) => any) => {
    this.listeners.push(fn);
    return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== fn); } };
  };
  fire(data?: any) { for (const l of this.listeners) l(data as T); }
  dispose() { this.listeners = []; }
}

export class Uri {
  private constructor(public readonly scheme: string, public readonly fsPath: string) {}
  static file(p: string) { return new Uri("file", p); }
  static parse(s: string) { return new Uri("https", s); }
  static joinPath(base: Uri, ...parts: string[]) {
    return Uri.file(path.resolve(base.fsPath, ...parts));
  }
  get path() { return this.fsPath; }
  toString() { return `${this.scheme}://${this.fsPath}`; }
  with() { return this; }
}

export class TreeItem {
  label?: any;
  id?: string;
  iconPath?: any;
  description?: any;
  tooltip?: any;
  command?: any;
  contextValue?: string;
  collapsibleState?: TreeItemCollapsibleState;
  resourceUri?: Uri;
  constructor(label: any, state?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = state ?? TreeItemCollapsibleState.None;
  }
}

export class MarkdownString {
  constructor(public value = "") {}
  appendMarkdown(v: string) { this.value += v; return this; }
  isTrusted = false;
  supportHtml = false;
}
export class Range { constructor(public a: any, public b: any, public c?: any, public d?: any) {} }
export class Position { constructor(public line: number, public character: number) {} }
export class CodeLens { constructor(public range: any, public command?: any) {} }
export class RelativePattern { constructor(public base: any, public pattern: string) {} }
export class Disposable { static from() { return { dispose() {} }; } dispose() {} }

export const recorded = {
  info: [] as string[],
  warn: [] as string[],
  error: [] as string[],
  documents: [] as { content: string; language?: string }[],
  panels: [] as { viewType: string; title: string; html: string }[],
  answers: new Map<string, any>(),
};

export const commands = {
  _registry: new Map<string, (...a: any[]) => any>(),
  registerCommand(id: string, fn: (...a: any[]) => any) {
    commands._registry.set(id, fn);
    return { dispose() {} };
  },
  registerTextEditorCommand(id: string, fn: any) { return commands.registerCommand(id, fn); },
  async executeCommand(id: string, ...args: any[]) {
    const fn = commands._registry.get(id);
    if (!fn) return undefined;
    return fn(...args);
  },
  getCommands: async () => [...commands._registry.keys()],
};

const settings = new Map<string, any>(Object.entries({
  baseUrl: "https://quera.org/",
  authMethod: "sessionId",
  locale: "fa",
  defaultLanguage: "python",
  editorDirection: "auto",
  enableSubmission: false,
  enableWrite: false,
  readOnly: false,
  sandbox: "none",
  problemsetPageSize: 25,
  solutionsDir: "quera",
  autoRegisterMcp: false,
  openDashboardOnStartup: false,
  fontSize: 14.5,
}));

export const workspace = {
  workspaceFolders: [] as { uri: Uri; name: string; index: number }[],
  getConfiguration(section?: string) {
    return {
      get: (key: string, fallback?: any) => (settings.has(key) ? settings.get(key) : fallback),
      update: async (key: string, value: any) => { settings.set(key, value); },
      has: (key: string) => settings.has(key),
      inspect: () => undefined,
    };
  },
  onDidChangeConfiguration: new EventEmitter<any>().event,
  onDidSaveTextDocument: new EventEmitter<any>().event,
  onDidChangeWorkspaceFolders: new EventEmitter<any>().event,
  onDidChangeTextDocument: new EventEmitter<any>().event,
  createFileSystemWatcher: () => ({
    onDidCreate: new EventEmitter<any>().event,
    onDidChange: new EventEmitter<any>().event,
    onDidDelete: new EventEmitter<any>().event,
    dispose() {},
  }),
  async openTextDocument(opts: any) {
    const content = typeof opts === "string" ? opts : opts?.content ?? "";
    recorded.documents.push({ content, language: opts?.language });
    return { getText: () => content, uri: Uri.file("untitled"), languageId: opts?.language, save: async () => true };
  },
  fs: {
    async readFile(uri: Uri) { return nodeFs.readFileSync(uri.fsPath); },
    async writeFile(uri: Uri, data: Uint8Array) {
      nodeFs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
      nodeFs.writeFileSync(uri.fsPath, data);
    },
    async createDirectory(uri: Uri) { nodeFs.mkdirSync(uri.fsPath, { recursive: true }); },
    async readDirectory(uri: Uri): Promise<[string, FileType][]> {
      return nodeFs.readdirSync(uri.fsPath, { withFileTypes: true })
        .map((d) => [d.name, d.isDirectory() ? FileType.Directory : FileType.File]);
    },
    async stat(uri: Uri) {
      const s = nodeFs.statSync(uri.fsPath);
      return { type: s.isDirectory() ? FileType.Directory : FileType.File, size: s.size, ctime: 0, mtime: 0 };
    },
    async delete(uri: Uri) { nodeFs.rmSync(uri.fsPath, { recursive: true, force: true }); },
  },
  findFiles: async () => [],
  asRelativePath: (u: any) => String(u?.fsPath ?? u),
};

export const window = {
  activeTextEditor: undefined as any,
  visibleTextEditors: [] as any[],
  showInformationMessage: async (m: string, ...rest: any[]) => {
    recorded.info.push(m);
    return recorded.answers.get(m);
  },
  showWarningMessage: async (m: string, ...rest: any[]) => {
    recorded.warn.push(m);
    return recorded.answers.get(m);
  },
  showErrorMessage: async (m: string, ...rest: any[]) => {
    recorded.error.push(m);
    return recorded.answers.get(m);
  },
  showQuickPick: async (items: any) => {
    const list = await items;
    return recorded.answers.get("quickPick") ?? (Array.isArray(list) ? list[0] : undefined);
  },
  showInputBox: async (opts?: any) => {
    const table = recorded.answers.get("inputBoxByPrompt") as [RegExp, string][] | undefined;
    const asked = `${opts?.title || ""} ${opts?.prompt || ""}`;
    const matched = table?.find(([pattern]) => pattern.test(asked))?.[1];
    const canned = matched ?? recorded.answers.get("inputBox");
    for (const candidate of [canned, opts?.value]) {
      if (candidate === undefined) continue;
      if (!opts?.validateInput) return candidate;
      if (!(await opts.validateInput(String(candidate)))) return candidate;
    }
    return undefined;
  },
  showOpenDialog: async () => recorded.answers.get("openDialog"),
  showSaveDialog: async () => recorded.answers.get("saveDialog"),
  showTextDocument: async (doc: any) => ({ document: doc, edit: async () => true }),
  withProgress: async (_opts: any, task: any) => task({ report() {} }, { isCancellationRequested: false }),
  createTreeView: (id: string, opts: any) => ({
    id, visible: true, onDidChangeVisibility: new EventEmitter<any>().event,
    reveal: async () => {}, dispose() {},
  }),
  registerTreeDataProvider: () => ({ dispose() {} }),
  createStatusBarItem: () => ({ text: "", tooltip: "" as any, command: "", backgroundColor: undefined as any, show() {}, hide() {}, dispose() {} }),
  createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {} }),

  createQuickPick: () => {
    const onValue: ((v: string) => void)[] = [];
    const onAccept: (() => void)[] = [];
    const onHide: (() => void)[] = [];
    const qp: any = {
      title: "", placeholder: "", value: "", busy: false, items: [] as any[],
      selectedItems: [] as any[], matchOnDescription: false, matchOnDetail: false,
      ignoreFocusOut: false,
      onDidChangeValue: (fn: any) => { onValue.push(fn); return { dispose() {} }; },
      onDidAccept: (fn: any) => { onAccept.push(fn); return { dispose() {} }; },
      onDidHide: (fn: any) => { onHide.push(fn); return { dispose() {} }; },
      show() {
        const table = (recorded.answers.get("inputBoxByPrompt") || []) as [RegExp, string][];
        const hit = table.find(([re]) => re.test("search problems"));
        const typed = String(hit ? hit[1] : "3537");
        qp.value = typed;
        for (const fn of onValue) fn(typed);
        setTimeout(() => {
          qp.selectedItems = qp.items.slice(0, 1);
          for (const fn of onAccept) fn();
        }, 600);
      },
      hide() { for (const fn of onHide) fn(); },
      dispose() {},
    };
    return qp;
  },
  createTerminal: () => ({ sendText() {}, show() {}, dispose() {} }),
  createWebviewPanel: (viewType: string, title: string) => {
    const entry = { viewType, title, html: "" };
    recorded.panels.push(entry);
    return {
      viewType, title,
      webview: {
        get html() { return entry.html; },
        set html(v: string) { entry.html = v; },
        asWebviewUri: (u: Uri) => Uri.parse(`https://webview.test${u.fsPath}`),
        cspSource: "https://webview.test",
        onDidReceiveMessage: new EventEmitter<any>().event,
        postMessage: async () => true,
      },
      onDidDispose: new EventEmitter<any>().event,
      onDidChangeViewState: new EventEmitter<any>().event,
      reveal() {}, dispose() {},
    };
  },
  activeColorTheme: { kind: 2 },
  onDidChangeActiveTextEditor: new EventEmitter<any>().event,
};

export const languages = {
  registerCodeLensProvider: () => ({ dispose() {} }),
  registerCompletionItemProvider: () => ({ dispose() {} }),
  registerHoverProvider: () => ({ dispose() {} }),
  createDiagnosticCollection: () => ({ set() {}, clear() {}, delete() {}, dispose() {} }),
};

export const env = {
  openExternal: async () => true,
  clipboard: { writeText: async () => {}, readText: async () => "" },
  machineId: "test",
};

export const extensions = { getExtension: () => undefined, all: [] as any[] };
export const lm = { registerMcpServerDefinitionProvider: () => ({ dispose() {} }) };
export class McpStdioServerDefinition { constructor(public opts: any) {} }
export class CompletionItem { constructor(public label: string, public kind?: any) {} }
export enum CompletionItemKind { Snippet = 14, Text = 0 }
export class SnippetString { constructor(public value: string) {} }
export class WorkspaceEdit { insert() {} replace() {} delete() {} }
export class Hover { constructor(public contents: any) {} }
export const version = "1.85.0";
