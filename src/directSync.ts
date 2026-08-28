import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { getSettings, writeAllowed } from "./config";
import type { QueraService } from "./service";
import {
  Binding, getBinding, joinTitleAndBody, removeBinding, setBinding, splitTitleAndBody,
} from "./binding";
import { createLesson, findSyncRepo, lessonSlug, SyncConfig } from "./repo";

export interface DirectSyncSettings {
  autoPublishOnSave: boolean;
  confirmBeforePublish: boolean;
  publishDelaySeconds: number;
}

export function directSyncSettings(): DirectSyncSettings {
  const c = vscode.workspace.getConfiguration("queracode.sync");
  return {
    autoPublishOnSave: !!c.get<boolean>("autoPublishOnSave"),
    confirmBeforePublish: c.get<boolean>("confirmBeforePublish") ?? true,
    publishDelaySeconds: Math.max(0, c.get<number>("publishDelaySeconds") ?? 3),
  };
}

export async function bindingRoot(file: string): Promise<string | undefined> {
  const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  const repo = await findSyncRepo(folders);
  if (repo) return repo.root;
  return folders.find((f) => file.startsWith(f + path.sep)) ?? folders[0];
}

export class DirectSync implements vscode.Disposable {
  private timers = new Map<string, NodeJS.Timeout>();
  private disposables: vscode.Disposable[] = [];
  private readonly output: vscode.OutputChannel;
  private busy = new Set<string>();

  constructor(private readonly service: QueraService, output?: vscode.OutputChannel) {
    this.output = output ?? vscode.window.createOutputChannel("Quera Direct Sync");
    this.disposables.push(
      this.output,
      vscode.workspace.onDidSaveTextDocument((doc) => this.onSaved(doc))
    );
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
  }

  private onSaved(doc: vscode.TextDocument): void {
    if (doc.languageId !== "markdown") return;
    if (!directSyncSettings().autoPublishOnSave) return;
    const file = doc.uri.fsPath;
    const existing = this.timers.get(file);
    if (existing) clearTimeout(existing);
    this.timers.set(file, setTimeout(() => {
      this.timers.delete(file);
      void this.push(file, { auto: true });
    }, directSyncSettings().publishDelaySeconds * 1000));
  }

  async push(file: string, opts: { auto?: boolean } = {}): Promise<boolean> {
    if (this.busy.has(file)) return false;
    const root = await bindingRoot(file);
    if (!root) return false;
    const binding = await getBinding(root, file);
    if (!binding) {
      if (!opts.auto) {
        const pick = await vscode.window.showWarningMessage(
          `«${path.basename(file)}» به هیچ درسنامه یا تمرینی در کوئرا وصل نیست.`, "اتصال…");
        if (pick) await vscode.commands.executeCommand("queracode.bindFile");
      }
      return false;
    }
    if (!writeAllowed(getSettings())) {
      if (opts.auto) {
        this.log(`skipped publish of ${path.basename(file)}: queracode.enableWrite is off`);
        return false;
      }
      const pick = await vscode.window.showWarningMessage(
        "انتشار روی کوئرا خاموش است («queracode.enableWrite» پیش‌فرض خاموش است تا چیزی ناخواسته منتشر نشود).",
        "روشن کن", "انصراف");
      if (pick !== "روشن کن") return false;
      const cfg = vscode.workspace.getConfiguration("queracode");
      await cfg.update("enableWrite", true, vscode.ConfigurationTarget.Global);
      if (getSettings().readOnly) await cfg.update("readOnly", false, vscode.ConfigurationTarget.Global);
    }

    const raw = await fs.readFile(file, "utf8");
    const { title, body } = splitTitleAndBody(raw);
    const label = title || binding.title || `#${binding.itemId}`;

    if (!opts.auto && directSyncSettings().confirmBeforePublish) {
      const ok = await vscode.window.showWarningMessage(
        `انتشار «${label}» روی کوئرا؟`,
        {
          modal: true,
          detail: "این تغییر بلافاصله برای دانشجویان دیده می‌شود و مرحلهٔ بازبینی ندارد.",
        },
        "انتشار"
      );
      if (ok !== "انتشار") return false;
    }

    this.busy.add(file);
    try {
      const client = await this.service.getClient();
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `انتشار «${label}» روی کوئرا…` },
        async () => {
          if (binding.kind === "lesson" && binding.area === "college") {
            await client.publishLesson(binding.chapterId, binding.itemId,
              { name: title, description: body });
          } else {
            await client.updateAssignmentProblem(binding.chapterId, binding.itemId, {
              area: binding.area, name: title, description: body,
            });
          }
        });
      await setBinding(root, file, { ...binding, title: title ?? binding.title, publishedAt: new Date().toISOString() });
      this.log(`published ${path.basename(file)} → ${binding.area} #${binding.itemId}`);
      vscode.window.setStatusBarMessage(`$(cloud-upload) «${label}» منتشر شد`, 4000);
      return true;
    } catch (e: any) {
      this.log(`publish failed for ${path.basename(file)}: ${e?.message || e}`);
      const pick = await vscode.window.showErrorMessage(
        `انتشار «${label}» ناموفق بود: ${e?.message || e}`, "گزارش", "خاموش‌کردن انتشار خودکار");
      if (pick === "گزارش") this.output.show(true);
      if (pick === "خاموش‌کردن انتشار خودکار") {
        await vscode.workspace.getConfiguration("queracode.sync")
          .update("autoPublishOnSave", false, vscode.ConfigurationTarget.Workspace);
      }
      return false;
    } finally {
      this.busy.delete(file);
    }
  }

  async pull(file: string): Promise<boolean> {
    const root = await bindingRoot(file);
    if (!root) return false;
    const binding = await getBinding(root, file);
    if (!binding) {
      vscode.window.showWarningMessage(`«${path.basename(file)}» به چیزی در کوئرا وصل نیست.`);
      return false;
    }
    try {
      const client = await this.service.getClient();
      const fetched = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "دریافت از کوئرا…" },
        async () => {
          if (binding.kind === "lesson" && binding.area === "college") {
            const body = await client.getLessonBody(binding.chapterId, binding.itemId);
            return { name: binding.title, description: body };
          }
          const detail = await client.getAssignmentProblem(
            binding.chapterId, binding.itemId, binding.area === "contest" ? "contest" : "course");
          return { name: detail.name, description: detail.description };
        });
      if (fetched.description === undefined) {
        vscode.window.showWarningMessage("کوئرا متنی برای این مورد برنگرداند (شاید دسترسی ویرایش ندارید).");
        return false;
      }
      const merged = joinTitleAndBody(fetched.name, fetched.description);
      const current = await fs.readFile(file, "utf8").catch(() => "");
      if (current.trim() === merged.trim()) {
        vscode.window.setStatusBarMessage("$(check) از قبل به‌روز بود", 3000);
        return true;
      }
      if (current.trim()) {
        const ok = await vscode.window.showWarningMessage(
          `بازنویسی «${path.basename(file)}» با نسخهٔ کوئرا؟`,
          { modal: true, detail: "محتوای محلی جایگزین می‌شود. برای دیدن تفاوت‌ها «مقایسه» را بزنید." },
          "بازنویسی", "مقایسه"
        );
        if (ok === "مقایسه") {
          const tmp = vscode.Uri.parse(`untitled:${file}.quera-remote.md`);
          const doc = await vscode.workspace.openTextDocument(tmp);
          const edit = new vscode.WorkspaceEdit();
          edit.insert(tmp, new vscode.Position(0, 0), merged);
          await vscode.workspace.applyEdit(edit);
          await vscode.commands.executeCommand("vscode.diff",
            vscode.Uri.file(file), tmp, `${path.basename(file)} ↔ کوئرا`);
          return false;
        }
        if (ok !== "بازنویسی") return false;
      }
      await fs.writeFile(file, merged, "utf8");
      await setBinding(root, file, { ...binding, title: fetched.name ?? binding.title, pulledAt: new Date().toISOString() });
      this.log(`pulled ${binding.area} #${binding.itemId} → ${path.basename(file)}`);
      return true;
    } catch (e: any) {
      vscode.window.showErrorMessage(`دریافت ناموفق بود: ${e?.message || e}`);
      return false;
    }
  }

  async importCollege(
    root: string,
    config: SyncConfig,
    collegeId: number,
    slug: string | undefined,
    opts: { overwrite: boolean }
  ): Promise<{ created: number; updated: number; skipped: number }> {
    const client = await this.service.getClient();
    const tree = await client.getCollegeChapters(collegeId, slug);
    let created = 0, updated = 0, skipped = 0;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "دریافت کالج در مخزن…", cancellable: true },
      async (progress, token) => {
        const chapters = tree.chapters;
        for (const [ci, chapter] of chapters.entries()) {
          if (token.isCancellationRequested) return;
          const mapped = config.chapters.find((c) => c.name === chapter.name)
            ?? config.chapters[ci];
          if (!mapped) { skipped += chapter.items.length; continue; }
          progress.report({
            message: `${chapter.name} (${ci + 1}/${chapters.length})`,
            increment: 100 / chapters.length,
          });
          for (const item of chapter.items) {
            if (token.isCancellationRequested) return;
            const kind: Binding["kind"] = item.kind === "lesson" ? "lesson" : "problem";
            let body: string | undefined;
            try {
              body = kind === "lesson"
                ? await client.getLessonBody(chapter.id, item.id)
                : (await client.getAssignmentProblem(chapter.id, item.id, "course")).description;
            } catch {
              skipped++;
              continue;
            }
            if (body === undefined) { skipped++; continue; }

            const chapterDir = path.join(root, config.source.root, mapped.local_path);
            const existing = await findLessonDirByTitle(chapterDir, config.source.lesson_file, item.name);
            const content = joinTitleAndBody(item.name, body);
            if (existing) {
              if (!opts.overwrite) { skipped++; continue; }
              await fs.writeFile(path.join(existing, config.source.lesson_file), content, "utf8");
              await setBinding(root, path.join(existing, config.source.lesson_file), {
                kind, chapterId: chapter.id, itemId: item.id, area: "college",
                collegeId, title: item.name, pulledAt: new Date().toISOString(),
              });
              updated++;
            } else {
              const made = await createLesson(root, config, mapped.local_path, item.name,
                joinTitleAndBody(undefined, body));
              await fs.writeFile(made.file, content, "utf8");
              await setBinding(root, made.file, {
                kind, chapterId: chapter.id, itemId: item.id, area: "college",
                collegeId, title: item.name, pulledAt: new Date().toISOString(),
              });
              created++;
            }
          }
        }
      });
    this.log(`import: ${created} created, ${updated} updated, ${skipped} skipped`);
    return { created, updated, skipped };
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const d of this.disposables) d.dispose();
  }
}

async function findLessonDirByTitle(
  chapterDir: string,
  lessonFile: string,
  title: string
): Promise<string | undefined> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(chapterDir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(chapterDir, entry.name, lessonFile);
    try {
      const raw = await fs.readFile(file, "utf8");
      const first = raw.split("\n").find((l) => l.trim().startsWith("# "));
      if (first && first.trim().slice(2).trim() === title) return path.join(chapterDir, entry.name);
    } catch {
      /* not a lesson folder */
    }
  }
  return undefined;
}

export { lessonSlug };
