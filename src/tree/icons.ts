import * as vscode from "vscode";


const themeColor = (id: string) => new vscode.ThemeColor(id);

export const QUERA_ACCENT = "charts.blue";

const DIFFICULTY_ICON: Record<string, { id: string; color: string }> = {
  EASY: { id: "circle-outline", color: "charts.green" },
  MEDIUM: { id: "circle-filled", color: QUERA_ACCENT },
  HARD: { id: "flame", color: "charts.red" },
};

export const icons = {
  college: () => new vscode.ThemeIcon("mortar-board", themeColor(QUERA_ACCENT)),
  class: () => new vscode.ThemeIcon("organization", themeColor(QUERA_ACCENT)),
  contest: () => new vscode.ThemeIcon("trophy", themeColor("charts.yellow")),
  chapter: () => new vscode.ThemeIcon("folder", themeColor(QUERA_ACCENT)),
  lesson: () => new vscode.ThemeIcon("book", themeColor("charts.purple")),
  submission: () => new vscode.ThemeIcon("history"),
  library: () => new vscode.ThemeIcon("archive", themeColor(QUERA_ACCENT)),
  tool: (id: string) => new vscode.ThemeIcon(id),

  problem(difficulty?: string): vscode.ThemeIcon {
    const spec = DIFFICULTY_ICON[String(difficulty || "").toUpperCase()];
    return spec
      ? new vscode.ThemeIcon(spec.id, themeColor(spec.color))
      : new vscode.ThemeIcon("circle-filled", themeColor(QUERA_ACCENT));
  },

  verdict(accepted?: boolean): vscode.ThemeIcon {
    if (accepted === undefined) return new vscode.ThemeIcon("clock", themeColor("charts.yellow"));
    return accepted
      ? new vscode.ThemeIcon("pass-filled", themeColor("testing.iconPassed"))
      : new vscode.ThemeIcon("error", themeColor("testing.iconFailed"));
  },

  signIn: () => new vscode.ThemeIcon("sign-in", themeColor(QUERA_ACCENT)),
  info: () => new vscode.ThemeIcon("info"),
  error: () => new vscode.ThemeIcon("error", themeColor("testing.iconFailed")),
  loading: () => new vscode.ThemeIcon("loading~spin"),
  more: () => new vscode.ThemeIcon("chevron-down"),
  filter: () => new vscode.ThemeIcon("list-filter", themeColor(QUERA_ACCENT)),
};

export function infoRow(
  label: string,
  icon: vscode.ThemeIcon,
  command?: vscode.Command,
  tooltip?: string
): vscode.TreeItem {
  const item = new vscode.TreeItem(label);
  item.iconPath = icon;
  if (command) item.command = command;
  if (tooltip) item.tooltip = tooltip;
  return item;
}
