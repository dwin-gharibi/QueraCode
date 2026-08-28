import * as vscode from "vscode";
import * as path from "path";
import { getSettings, writeAllowed } from "./config";
import {
  SYNC_CONFIG, SyncConfig, commitAndPush, findSyncRepo, hasConflicts, pullRepo,
  renderCommitMessage, repoStatus,
} from "./repo";

export { hasConflicts, renderCommitMessage };

const PULL_MIN_MINUTES = 1;
const PUSH_MIN_SECONDS = 5;

export interface RepoSyncSettings {
  autoPull: boolean;
  autoPush: boolean;
  pullIntervalMinutes: number;
  pushDelaySeconds: number;
  commitMessage: string;
  branch: string;
}

export function repoSyncSettings(): RepoSyncSettings {
  const c = vscode.workspace.getConfiguration("queracode.repo");
  return {
    autoPull: !!c.get<boolean>("autoPull"),
    autoPush: !!c.get<boolean>("autoPush"),
    pullIntervalMinutes: Math.max(PULL_MIN_MINUTES, c.get<number>("autoPullIntervalMinutes") ?? 15),
    pushDelaySeconds: Math.max(PUSH_MIN_SECONDS, c.get<number>("autoPushDelaySeconds") ?? 45),
    commitMessage: c.get<string>("commitMessage") || "درسنامه: ${files} (QueraCode)",
    branch: (c.get<string>("branch") || "").trim(),
  };
}

export class RepoSync implements vscode.Disposable {
  private repo?: { root: string; config: SyncConfig };
  private status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
  private pullTimer?: NodeJS.Timeout;
  private pushTimer?: NodeJS.Timeout;
  private pendingFiles = new Set<string>();
  private busy = false;
  private disposables: vscode.Disposable[] = [];
  private readonly output: vscode.OutputChannel;

  constructor(output?: vscode.OutputChannel) {
    this.output = output ?? vscode.window.createOutputChannel("Quera Course Sync");
    this.status.command = "queracode.repoStatus";
    this.disposables.push(
      this.status,
      this.output,
      vscode.workspace.onDidSaveTextDocument((doc) => this.onSaved(doc)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.discover()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("queracode.repo")) this.reschedule();
      })
    );
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
  }

  async discover(): Promise<void> {
    const roots = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
    this.repo = await findSyncRepo(roots);
    if (!this.repo) {
      this.status.hide();
      this.stopTimers();
      return;
    }
    this.log(`course repo: ${this.repo.root} (college #${this.repo.config.college.college_id})`);
    await this.refreshStatus();
    this.reschedule();
  }

  private stopTimers(): void {
    if (this.pullTimer) { clearInterval(this.pullTimer); this.pullTimer = undefined; }
    if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = undefined; }
  }

  private reschedule(): void {
    this.stopTimers();
    if (!this.repo) return;
    const s = repoSyncSettings();
    if (s.autoPull) {
      this.pullTimer = setInterval(() => void this.autoPull(), s.pullIntervalMinutes * 60_000);
      void this.autoPull();
    }
    void this.refreshStatus();
  }

  async autoPull(silent = true): Promise<void> {
    if (!this.repo || this.busy) return;
    this.busy = true;
    try {
      const before = await repoStatus(this.repo.root);
      if (hasConflicts(before)) {
        this.log("skipped pull: the working tree has unresolved conflicts");
        return;
      }
      if (before.dirty.length) {
        this.log(`skipped pull: ${before.dirty.length} uncommitted change(s)`);
        return;
      }
      const out = await pullRepo(this.repo.root);
      if (/Already up to date|Already up-to-date/i.test(out)) this.log("pull: already up to date");
      else {
        this.log(`pull: ${out.split("\n")[0]}`);
        if (!silent) vscode.window.showInformationMessage("Course repository updated.");
        else vscode.window.setStatusBarMessage("$(cloud-download) Quera course repo updated", 4000);
      }
    } catch (e: any) {
      this.log(`pull failed: ${e?.message || e}`);
    } finally {
      this.busy = false;
      await this.refreshStatus();
    }
  }

  private onSaved(doc: vscode.TextDocument): void {
    if (!this.repo) return;
    const file = doc.uri.fsPath;
    if (!file.startsWith(this.repo.root + path.sep)) return;
    const rel = path.relative(this.repo.root, file);
    if (rel.startsWith(".git" + path.sep) || rel === SYNC_CONFIG) return;
    this.pendingFiles.add(rel);
    void this.refreshStatus();

    const s = repoSyncSettings();
    if (!s.autoPush) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.autoPush(), s.pushDelaySeconds * 1000);
  }

  async autoPush(): Promise<void> {
    if (!this.repo || this.busy) return;
    const s = getSettings();
    if (!writeAllowed(s)) {
      this.log("skipped push: queracode.enableWrite is off (pushing publishes to the live college)");
      return;
    }
    this.busy = true;
    const files = [...this.pendingFiles];
    try {
      const before = await repoStatus(this.repo.root);
      if (hasConflicts(before)) {
        vscode.window.showWarningMessage(
          "Quera course repo has unresolved conflicts — auto-push paused until you resolve them.");
        return;
      }
      if (!before.dirty.length) { this.log("nothing to push"); return; }
      const sync = repoSyncSettings();
      const message = renderCommitMessage(sync.commitMessage, files, new Date());
      const branch = await commitAndPush(this.repo.root, message, sync.branch || undefined);
      if (branch) {
        this.pendingFiles.clear();
        this.log(`pushed to ${branch}: ${message}`);
        vscode.window.setStatusBarMessage(`$(cloud-upload) Quera course repo pushed (${branch})`, 5000);
      }
    } catch (e: any) {
      this.log(`push failed: ${e?.message || e}`);
      const pick = await vscode.window.showErrorMessage(
        `Auto-push to the course repository failed: ${e?.message || e}`, "Show log", "Turn off auto-push");
      if (pick === "Show log") this.output.show(true);
      if (pick === "Turn off auto-push") {
        await vscode.workspace.getConfiguration("queracode.repo")
          .update("autoPush", false, vscode.ConfigurationTarget.Workspace);
      }
    } finally {
      this.busy = false;
      await this.refreshStatus();
    }
  }

  async pushNow(): Promise<void> {
    if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = undefined; }
    await this.autoPush();
  }

  private async refreshStatus(): Promise<void> {
    if (!this.repo) { this.status.hide(); return; }
    try {
      const st = await repoStatus(this.repo.root);
      const s = repoSyncSettings();
      const bits = [
        st.dirty.length ? `${st.dirty.length}$(pencil)` : "",
        st.ahead ? `${st.ahead}$(arrow-up)` : "",
        st.behind ? `${st.behind}$(arrow-down)` : "",
      ].filter(Boolean).join(" ");
      const conflicted = hasConflicts(st);
      this.status.text = `$(repo) ${st.branch}${bits ? ` ${bits}` : ""}`;
      this.status.backgroundColor = conflicted
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : undefined;
      this.status.tooltip = new vscode.MarkdownString(
        `**Quera course repository**\n\n` +
          `College #${this.repo.config.college.college_id} · branch \`${st.branch}\`\n\n` +
          (conflicted ? "⚠️ Unresolved conflicts — sync is paused.\n\n" : "") +
          `Uncommitted: ${st.dirty.length} · ahead ${st.ahead} · behind ${st.behind}\n\n` +
          `Auto-pull: ${s.autoPull ? `every ${s.pullIntervalMinutes} min` : "off"}\n\n` +
          `Auto-push: ${s.autoPush ? `${s.pushDelaySeconds}s after a save` : "off"}` +
          (s.branch ? ` → \`${s.branch}\`` : "") + "\n\n" +
          `Click for the full status.`
      );
      this.status.show();
    } catch {
      this.status.hide();
    }
  }

  get root(): string | undefined {
    return this.repo?.root;
  }

  dispose(): void {
    this.stopTimers();
    for (const d of this.disposables) d.dispose();
  }
}
