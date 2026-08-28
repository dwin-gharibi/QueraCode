import * as vscode from "vscode";

let extensionUri: vscode.Uri | undefined;

export function setExtensionUri(uri: vscode.Uri): void {
  extensionUri = uri;
}

export function fontsBase(webview: vscode.Webview): string | undefined {
  if (!extensionUri) return undefined;
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "fonts")).toString();
}

export function katexBase(webview: vscode.Webview): string | undefined {
  if (!extensionUri) return undefined;
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "node_modules", "katex", "dist")).toString();
}

export function mediaUri(webview: vscode.Webview, ...parts: string[]): string | undefined {
  if (!extensionUri) return undefined;
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", ...parts)).toString();
}

export const ILLUSTRATION = {
  hero: "quera-dev.png",
  learning: "learning.3-8793a3347695.png",
  contest: "contest.3-7b41f65df967.png",
  standings: "contest.3-7b41f65df967.png",
  job: "job.3-c9ebe72c1b28.png",
  resume: "resume_bank.3-ceec98546921.png",
  employer: "employer_brand.3-a8cd494d9265.png",
} as const;

export function illustration(webview: vscode.Webview, key: keyof typeof ILLUSTRATION): string | undefined {
  return mediaUri(webview, "illustrations", ILLUSTRATION[key]);
}

export function brandPanel(panel: vscode.WebviewPanel): vscode.WebviewPanel {
  if (extensionUri) {
    panel.iconPath = {
      light: vscode.Uri.joinPath(extensionUri, "media", "icons", "quera-tab-light.svg"),
      dark: vscode.Uri.joinPath(extensionUri, "media", "icons", "quera-tab-dark.svg"),
    };
  }
  return panel;
}

let globalState: vscode.Memento | undefined;

export function setGlobalState(m: vscode.Memento): void {
  globalState = m;
}

export interface Annotation {
  kind: "hl" | "note";
  text: string;
  note?: string;
}

export function loadAnnotations(key: string): Annotation[] {
  return globalState?.get<Annotation[]>(`queracode.annot.${key}`, []) ?? [];
}

export function saveAnnotations(key: string, list: Annotation[]): void {
  void globalState?.update(`queracode.annot.${key}`, list);
}
