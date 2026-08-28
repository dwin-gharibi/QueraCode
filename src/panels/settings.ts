import * as vscode from "vscode";
import { getSettings } from "../config";
import type { QueraService } from "../service";
import { repoSyncSettings } from "../repoSync";
import { btnIcon, DELEGATE_SCRIPT, escapeHtml, faNum, pageShell } from "./render";
import { brandPanel, fontsBase, katexBase } from "./webviewEnv";


let panel: vscode.WebviewPanel | undefined;

interface Toggle {
  key: string;
  label: string;
  detail: string;
  value: boolean;
  danger?: boolean;
}

function toggleRow(t: Toggle): string {
  return `<div class="switch ${t.value ? "on" : "off"}${t.danger ? " danger" : ""}">
    <button class="switch-btn" data-cmd="toggle" data-arg='${JSON.stringify(t.key)}'
            aria-pressed="${t.value}">
      <span class="switch-track"><span class="switch-knob"></span></span>
    </button>
    <div class="switch-copy">
      <b>${escapeHtml(t.label)}</b>
      <span class="dim">${escapeHtml(t.detail)}</span>
    </div>
    <span class="switch-state">${t.value ? "روشن" : "خاموش"}</span>
  </div>`;
}

function render(signedIn: boolean, username?: string): string {
  const s = getSettings();
  const r = repoSyncSettings();

  const account = `
    <div class="card">
      <h3>حساب کوئرا</h3>
      <p class="dim">${signedIn
        ? `وارد شده‌اید${username ? ` با نام کاربری <b>${escapeHtml(username)}</b>` : ""}.`
        : "هنوز وارد نشده‌اید. با نام کاربری و رمز عبور، یا با چسباندن session_id وارد شوید."}</p>
      <div class="actions">
        ${btnIcon("signin", signedIn ? "ورود دوباره" : "ورود به کوئرا", "cmd:queracode.login")}
        ${btnIcon("globe", "بررسی نشست", "cmd:queracode.whoami", "secondary")}
        ${signedIn ? btnIcon("upload", "خروج", "cmd:queracode.logout", "secondary") : ""}
      </div>
    </div>`;

  const safety = `
    <div class="card">
      <h3>ایمنی</h3>
      <p class="dim">هر دو کلید به‌صورت پیش‌فرض خاموش‌اند تا هیچ کاری ناخواسته انجام نشود.</p>
      ${toggleRow({
        key: "enableSubmission", label: "اجازهٔ ارسال پاسخ", value: s.enableSubmission, danger: true,
        detail: "هر ارسال یک تلاش مصرف می‌کند و در جدول امتیازات دیده می‌شود.",
      })}
      ${toggleRow({
        key: "enableWrite", label: "اجازهٔ تغییر محتوا", value: s.enableWrite, danger: true,
        detail: "انتشار درسنامه، ویرایش تمرین‌های کالج و بارگذاری تصویر.",
      })}
      ${toggleRow({
        key: "readOnly", label: "حالت فقط‌خواندنی", value: s.readOnly,
        detail: "کلید اصلی — وقتی روشن است، دو گزینهٔ بالا بی‌اثر می‌شوند.",
      })}
    </div>`;

  const repo = `
    <div class="card">
      <h3>همگام‌سازی مخزن کالج</h3>
      <p class="dim">مخزن گیت کالج: هر push، ورک‌فلوی انتشار را اجرا می‌کند و درسنامه‌های
      تغییرکرده را روی کالج زنده منتشر می‌کند.</p>
      ${toggleRow({
        key: "repo.autoPull", label: "دریافت خودکار", value: r.autoPull,
        detail: `هر ${faNum(r.pullIntervalMinutes)} دقیقه — فقط fast-forward و فقط وقتی تغییر ذخیره‌نشده‌ای نباشد.`,
      })}
      ${toggleRow({
        key: "repo.autoPush", label: "ارسال خودکار", value: r.autoPush, danger: true,
        detail: `${faNum(r.pushDelaySeconds)} ثانیه پس از آخرین ذخیره${r.branch ? ` روی شاخهٔ ${r.branch}` : ""} — نیازمند «اجازهٔ تغییر محتوا».`,
      })}
      <div class="actions">
        ${btnIcon("library", "اتصال کالج به این مخزن", "cmd:queracode.repoLink")}
        ${btnIcon("download", "به‌روزرسانی حالا", "cmd:queracode.repoPullNow", "secondary")}
        ${btnIcon("upload", "ارسال حالا", "cmd:queracode.repoSyncNow", "secondary")}
        ${btnIcon("history", "وضعیت مخزن", "cmd:queracode.repoStatus", "secondary")}
      </div>
      <div class="actions">
        ${btnIcon("edit", "شاخهٔ هدف", "setting:queracode.repo.branch", "secondary")}
        ${btnIcon("history", "فاصلهٔ دریافت", "setting:queracode.repo.autoPullIntervalMinutes", "secondary")}
        ${btnIcon("play", "تأخیر ارسال", "setting:queracode.repo.autoPushDelaySeconds", "secondary")}
      </div>
    </div>`;

  const workspace = `
    <div class="card">
      <h3>محیط کار</h3>
      <p class="dim">زبان پیش‌فرض: <b>${escapeHtml(s.defaultLanguage)}</b> ·
      اجرای نمونه‌ها: <b>${escapeHtml(s.sandbox)}</b> ·
      پوشهٔ کاری: <b>${escapeHtml(s.solutionsDir)}</b></p>
      <div class="actions">
        ${btnIcon("edit", "زبان پیش‌فرض", "setting:queracode.defaultLanguage", "secondary")}
        ${btnIcon("beaker", "نحوهٔ اجرا", "setting:queracode.sandbox", "secondary")}
        ${btnIcon("save", "پوشهٔ کاری", "setting:queracode.solutionsDir", "secondary")}
        ${btnIcon("table", "اندازهٔ صفحه", "setting:queracode.problemsetPageSize", "secondary")}
      </div>
    </div>`;

  const appearance = `
    <div class="card">
      <h3>ظاهر</h3>
      <p class="dim">جهت متن: <b>${escapeHtml(s.editorDirection)}</b> ·
      اندازهٔ قلم: <b>${faNum(s.fontSize)}</b> ·
      رنگ تأکید: <b>${escapeHtml(s.accentColor || "#0099CC")}</b></p>
      <div class="actions">
        ${btnIcon("table", "جهت متن", "setting:queracode.editorDirection", "secondary")}
        ${btnIcon("edit", "اندازهٔ قلم", "setting:queracode.fontSize", "secondary")}
        ${btnIcon("image", "رنگ تأکید", "setting:queracode.accentColor", "secondary")}
        ${btnIcon("code", "CSS سفارشی", "setting:queracode.customCss", "secondary")}
      </div>
    </div>`;

  const ai = `
    <div class="card">
      <h3>دستیار هوش مصنوعی</h3>
      <p class="dim">سرویس: <b>${escapeHtml(s.aiProvider)}</b>${s.aiModel ? ` · مدل: <b>${escapeHtml(s.aiModel)}</b>` : ""}.
      کلید در SecretStorage ذخیره می‌شود، نه در تنظیمات.</p>
      <div class="actions">
        ${btnIcon("sparkle", "پیکربندی سرویس", "cmd:queracode.ai.configure")}
        ${btnIcon("chat", "گفتگو", "cmd:queracode.ai.chat", "secondary")}
      </div>
    </div>`;

  return `
    <div class="actions">
      ${btnIcon("dashboard", "داشبورد", "cmd:queracode.openDashboard")}
      ${btnIcon("library", "راهنمای گام‌به‌گام", "cmd:queracode.openWalkthrough", "secondary")}
      ${btnIcon("table", "تنظیمات کامل VS Code", "settingsUi", "secondary")}
    </div>
    <div class="grid">
      ${account}${safety}${repo}${workspace}${appearance}${ai}
    </div>`;
}

export function showSettings(service: QueraService): void {
  const s = getSettings();
  if (panel) {
    panel.reveal();
  } else {
    panel = brandPanel(vscode.window.createWebviewPanel(
      "queracode.settings", "تنظیمات QueraCode", vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }));
    panel.onDidDispose(() => (panel = undefined));
    panel.webview.onDidReceiveMessage(async (msg) => {
      const type = String(msg?.type || "");
      if (type === "toggle") {
        const key = String(msg.arg);
        const cfg = vscode.workspace.getConfiguration("queracode");
        await cfg.update(key, !cfg.get<boolean>(key), vscode.ConfigurationTarget.Global);
        paint(service);
      } else if (type.startsWith("setting:")) {
        await vscode.commands.executeCommand("workbench.action.openSettings", type.slice(8));
      } else if (type === "settingsUi") {
        await vscode.commands.executeCommand("workbench.action.openSettings", "queracode");
      } else if (type.startsWith("cmd:")) {
        await vscode.commands.executeCommand(type.slice(4));
        paint(service);
      }
    });
  }
  paint(service);
  void s;
}

function paint(service: QueraService): void {
  if (!panel) return;
  const s = getSettings();
  const html = (signedIn: boolean, username?: string) =>
    pageShell("تنظیمات QueraCode", render(signedIn, username), s, {
      subtitle: "settings and actions",
      script: DELEGATE_SCRIPT,
      fontsBase: fontsBase(panel!.webview),
      katexBase: katexBase(panel!.webview),
    });
  panel.webview.html = html(false);
  void (async () => {
    const signedIn = await service.isSignedIn();
    let username: string | undefined;
    if (signedIn) {
      try { username = (await (await service.getClient()).whoami())?.username; } catch {}
    }
    if (panel) panel.webview.html = html(signedIn, username);
  })();
}

export function watchSettings(service: QueraService): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (panel && e.affectsConfiguration("queracode")) paint(service);
  });
}
