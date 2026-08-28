import * as vscode from "vscode";
import { getSettings } from "../config";
import type { QueraService } from "../service";
import { btnIcon, DELEGATE_SCRIPT, escapeHtml, pageShell } from "./render";
import { brandPanel, fontsBase, katexBase, mediaUri } from "./webviewEnv";


const SEEN_KEY = "queracode.welcomeShownFor";

let panel: vscode.WebviewPanel | undefined;

interface Card {
  icon: string;
  title: string;
  body: string;
  actions: Array<[icon: string, label: string, command: string, cls?: string]>;
}

function cards(signedIn: boolean): Card[] {
  return [
    {
      icon: "signin",
      title: "۱. ورود به کوئرا",
      body: signedIn
        ? "شما وارد شده‌اید. اگر نشست منقضی شد، دوباره وارد شوید — QueraCode با نام‌کاربری و رمز عبور هم وارد می‌شود."
        : "با نام کاربری (ایمیل یا شمارهٔ موبایل) و رمز عبور وارد شوید. اگر حساب شما با رمز یک‌بارمصرف یا Google/GitHub وارد می‌شود، به‌جای آن session_id را بچسبانید.",
      actions: [
        ["signin", signedIn ? "ورود دوباره" : "ورود به کوئرا", "cmd:queracode.login"],
        ["globe", "بررسی نشست", "cmd:queracode.whoami", "secondary"],
      ],
    },
    {
      icon: "search",
      title: "۲. پیداکردن تمرین",
      body: "همهٔ فیلترهای کوئرا — سختی، برچسب، نوع، دسته و وضعیت حل — در نمای «Problemset» هست. یا لینک یک تمرین را مستقیم باز کنید.",
      actions: [
        ["search", "جستجوی تمرین‌ها", "cmd:queracode.searchProblems"],
        ["globe", "بازکردن با لینک", "cmd:queracode.openProblemByUrl", "secondary"],
      ],
    },
    {
      icon: "play",
      title: "۳. حل، اجرا و ارسال",
      body: "کد را در زبان دلخواه بسازید، روی تست‌های نمونه در سندباکس اجرا کنید و بعد ارسال کنید. ارسال به‌صورت پیش‌فرض خاموش است تا تلاشی هدر نرود.",
      actions: [
        ["play", "اجرای نمونه‌ها", "cmd:queracode.runSamples"],
        ["rocket", "ارسال سریع", "cmd:queracode.quickSubmit", "secondary"],
      ],
    },
    {
      icon: "book",
      title: "۴. تألیف درسنامه و تمرین",
      body: "درسنامه و تمرین را در Markdown فارسی با پیش‌نمایش راست‌به‌چپ بنویسید و پیش از انتشار، Markdown و سیستم داوری کوئرا را اعتبارسنجی کنید.",
      actions: [
        ["book", "درسنامهٔ جدید", "cmd:queracode.newLesson"],
        ["edit", "تمرین جدید", "cmd:queracode.newProblem", "secondary"],
        ["beaker", "اعتبارسنجی داوری", "cmd:queracode.validateJudge", "secondary"],
      ],
    },
    {
      icon: "sparkle",
      title: "۵. دستیار هوش مصنوعی (اختیاری)",
      body: "به هر سرویس سازگار با OpenAI وصل شوید — OpenRouter، Anthropic، Groq، DeepSeek یا یک Ollama محلی. کلید در SecretStorage ذخیره می‌شود، نه در تنظیمات.",
      actions: [
        ["sparkle", "پیکربندی سرویس", "cmd:queracode.ai.configure"],
        ["chat", "گفتگو", "cmd:queracode.ai.chat", "secondary"],
      ],
    },
    {
      icon: "dashboard",
      title: "میان‌برها",
      body: "داشبورد Ctrl+Alt+D · ارسال Ctrl+Alt+Enter · اجرای نمونه‌ها Ctrl+Alt+R · پیش‌نمایش Ctrl+Alt+V · جستجو Ctrl+Alt+P",
      actions: [
        ["dashboard", "بازکردن داشبورد", "cmd:queracode.openDashboard"],
        ["table", "تنظیمات و کنترل‌ها", "cmd:queracode.openSettingsPanel", "secondary"],
        ["library", "راهنمای گام‌به‌گام", "cmd:queracode.openWalkthrough", "secondary"],
      ],
    },
  ];
}

function render(signedIn: boolean, version: string, hero?: string): string {
  const status = signedIn
    ? `<span class="verdict ok">وارد شده‌اید</span>`
    : `<span class="verdict bad">هنوز وارد نشده‌اید</span>`;
  const grid = cards(signedIn)
    .map(
      (c) => `<div class="card">
        <h3>${escapeHtml(c.title)}</h3>
        <p class="dim">${escapeHtml(c.body)}</p>
        <div class="actions">${c.actions
          .map(([icon, label, command, cls]) => btnIcon(icon, label, command, cls ?? ""))
          .join("")}</div>
      </div>`
    )
    .join("");
  return `
    <section class="hero">
      ${hero ? `<img class="hero-art" src="${hero}" alt="نوشتن و حل تمرین کوئرا در VS Code" />` : ""}
      <div class="hero-copy">
        <div class="meta">${status}<span class="chip">نسخهٔ ${escapeHtml(version)}</span></div>
        <p class="lead">QueraCode کوئرا را به VS Code می‌آورد: مرور و حل تمرین، ارسال و دیدن
        نتیجهٔ داوری، و تألیف درسنامه، تمرین و سیستم داوری کوئرا — همه با پشتیبانی کامل از
        فارسی و راست‌به‌چپ.</p>
      </div>
    </section>
    <div class="grid">${grid}</div>`;
}

export function showWelcome(service: QueraService, version: string): void {
  const s = getSettings();
  if (panel) {
    panel.reveal();
  } else {
    panel = brandPanel(
      vscode.window.createWebviewPanel("queracode.welcome", "به QueraCode خوش آمدید", vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
      })
    );
    panel.onDidDispose(() => (panel = undefined));
    panel.webview.onDidReceiveMessage((msg) => {
      if (typeof msg?.type === "string" && msg.type.startsWith("cmd:")) {
        void vscode.commands.executeCommand(msg.type.slice(4));
      }
    });
  }
  const paint = (signedIn: boolean) => {
    if (!panel) return;
    panel.webview.html = pageShell(
      "به QueraCode خوش آمدید",
      render(signedIn, version, mediaUri(panel.webview, "illustrations", "quera-dev.png")),
      s,
      {
        subtitle: "the Quera workbench for VS Code",
        script: DELEGATE_SCRIPT,
        fontsBase: fontsBase(panel.webview),
        katexBase: katexBase(panel.webview),
        cspSource: panel.webview.cspSource,
      }
    );
  };
  paint(false);
  void service.isSignedIn().then(paint);
}

export async function showWelcomeOnce(
  context: vscode.ExtensionContext,
  service: QueraService,
  version: string
): Promise<boolean> {
  if (context.globalState.get<string>(SEEN_KEY) === version) return false;
  await context.globalState.update(SEEN_KEY, version);
  showWelcome(service, version);
  return true;
}
