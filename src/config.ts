import * as vscode from "vscode";

const SECRET_SESSION = "queracode.sessionId";
const SECRET_CSRF = "queracode.csrfToken";
const SECRET_PASSWORD = "queracode.password";
const SECRET_AI_KEY = "queracode.ai.apiKey";

export interface QueraSettings {
  baseUrl: string;
  authMethod: "sessionId" | "usernamePassword";
  username: string;
  defaultLanguage: string;
  locale: string;
  editorDirection: "auto" | "rtl" | "ltr";
  persianFont: string;
  latinFont: string;
  monoFont: string;
  enableSubmission: boolean;
  enableWrite: boolean;
  readOnly: boolean;
  sandbox: "none" | "docker" | "local";
  problemsetPageSize: number;
  solutionsDir: string;
  autoRegisterMcp: boolean;
  aiProvider: string;
  aiModel: string;
  aiBaseUrl: string;
  openDashboardOnStartup: boolean;
  customCss: string;
  fontSize: number;
  accentColor: string;
}

export function getSettings(): QueraSettings {
  const c = vscode.workspace.getConfiguration("queracode");
  return {
    baseUrl: (c.get<string>("baseUrl") || "https://quera.org/").replace(/\/?$/, "/"),
    authMethod: c.get("authMethod") as QueraSettings["authMethod"],
    username: c.get<string>("username") || "",
    defaultLanguage: c.get<string>("defaultLanguage") || "python",
    locale: c.get<string>("locale") || "fa",
    editorDirection: (c.get("editorDirection") as QueraSettings["editorDirection"]) || "auto",
    persianFont: c.get<string>("persianFont") || "Vazirmatn, Tahoma, sans-serif",
    latinFont: c.get<string>("latinFont") || "Inter, system-ui, sans-serif",
    monoFont: c.get<string>("monoFont") || "JetBrains Mono, monospace",
    enableSubmission: !!c.get<boolean>("enableSubmission"),
    enableWrite: !!c.get<boolean>("enableWrite"),
    readOnly: !!c.get<boolean>("readOnly"),
    sandbox: (c.get("sandbox") as QueraSettings["sandbox"]) || "docker",
    problemsetPageSize: c.get<number>("problemsetPageSize") || 25,
    solutionsDir: c.get<string>("solutionsDir") || "quera",
    autoRegisterMcp: c.get<boolean>("autoRegisterMcp") ?? false,
    aiProvider: c.get<string>("ai.provider") || "openrouter",
    aiModel: c.get<string>("ai.model") || "",
    aiBaseUrl: c.get<string>("ai.baseUrl") || "",
    openDashboardOnStartup: c.get<boolean>("openDashboardOnStartup") ?? false,
    customCss: c.get<string>("customCss") || "",
    fontSize: c.get<number>("fontSize") || 14.5,
    accentColor: (c.get<string>("accentColor") || "").match(/^#[0-9a-fA-F]{6}$/) ? c.get<string>("accentColor")! : "",
  };
}

export function queraOrigin(): string {
  return getSettings().baseUrl.replace(/\/+$/, "");
}

export function problemUrl(pk: number | string, area?: string, assignmentPk?: number | string): string {
  return area && assignmentPk
    ? `${queraOrigin()}/${area}/assignments/${assignmentPk}/problems/${pk}`
    : `${queraOrigin()}/problemset/${pk}`;
}

export function submissionAllowed(s: QueraSettings): boolean {
  return s.enableSubmission && !s.readOnly;
}

export function writeAllowed(s: QueraSettings): boolean {
  return s.enableWrite && !s.readOnly;
}

export class Secrets {
  constructor(private readonly store: vscode.SecretStorage) {}
  getSession() { return this.store.get(SECRET_SESSION); }
  setSession(v: string) { return this.store.store(SECRET_SESSION, v); }
  deleteSession() { return this.store.delete(SECRET_SESSION); }
  getCsrf() { return this.store.get(SECRET_CSRF); }
  setCsrf(v: string) { return this.store.store(SECRET_CSRF, v); }
  getPassword() { return this.store.get(SECRET_PASSWORD); }
  setPassword(v: string) { return this.store.store(SECRET_PASSWORD, v); }
  getAiKey() { return this.store.get(SECRET_AI_KEY); }
  setAiKey(v: string) { return this.store.store(SECRET_AI_KEY, v); }
  deleteAiKey() { return this.store.delete(SECRET_AI_KEY); }
  async clear() {
    await this.store.delete(SECRET_SESSION);
    await this.store.delete(SECRET_CSRF);
    await this.store.delete(SECRET_PASSWORD);
  }
}
