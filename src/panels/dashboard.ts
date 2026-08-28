import * as vscode from "vscode";
import { getSettings } from "../config";
import { QueraService } from "../service";
import { btnIcon, DELEGATE_SCRIPT, escapeHtml, faNum, faPercent, pageShell, PULSE_LOADER } from "./render";
import { brandPanel, fontsBase, illustration, katexBase, mediaUri } from "./webviewEnv";


let panel: vscode.WebviewPanel | undefined;

function bar(percent: number, label = "پیشرفت"): string {
  const p = Math.max(0, Math.min(100, percent));
  return `<div class="progress">
    <div class="progress-head">
      <span class="progress-label">${escapeHtml(label)}</span>
      <span class="progress-value">${faPercent(p)}</span>
    </div>
    <div class="bar" role="progressbar" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100">
      <div class="bar-fill" style="width:${p.toFixed(1)}%"></div>
    </div>
  </div>`;
}

function btn(label: string, cmd: string, arg?: unknown, cls = ""): string {
  const dataArg = arg === undefined ? "" : ` data-arg='${JSON.stringify(arg)}'`;
  return `<button ${cls ? `class="${cls}" ` : ""}data-cmd="${cmd}"${dataArg}>${label}</button>`;
}

function link(label: string, cmd: string, arg?: unknown, cls = ""): string {
  const dataArg = arg === undefined ? "" : ` data-arg='${JSON.stringify(arg)}'`;
  return `<a href="#" ${cls ? `class="${cls}" ` : ""}data-cmd="${cmd}"${dataArg}>${label}</a>`;
}

function actionButtons(signedIn: boolean): string {
  if (!signedIn) return btnIcon("signin", "ورود به کوئرا", "cmd:queracode.login");
  return [
    btnIcon("search", "جستجوی تمرین‌ها", "cmd:queracode.searchProblems"),
    btnIcon("filter", "فیلترها", "cmd:queracode.setFilters"),
    btnIcon("book", "درسنامهٔ جدید", "cmd:queracode.newLesson"),
    btnIcon("beaker", "تولید تست", "cmd:queracode.generateTestInputs"),
    btnIcon("rocket", "ارسال سریع", "cmd:queracode.quickSubmit"),
    btnIcon("chat", "گفتگو با AI", "cmd:queracode.ai.chat"),
    btnIcon("refresh", "به‌روزرسانی", "cmd:queracode.openDashboard", "secondary"),
  ].join("");
}

function card(title: string, art: string | undefined, inner: string, cls = ""): string {
  return `<div class="card${cls ? ` ${cls}` : ""}">
    <div class="card-head">
      ${art ? `<img class="card-art" src="${art}" alt="" aria-hidden="true" />` : ""}
      <h3>${escapeHtml(title)}</h3>
    </div>
    ${inner}
  </div>`;
}

function renderDashboard(d: any, classes: any, signedIn: boolean, art: Record<string, string | undefined> = {}): string {
  const user = d.user || {};
  const data = d.data || {};
  const colleges: any[] = data.latest_colleges || [];
  const classList: any[] = data.latest_courses || [];
  const contests: any[] = data.contest_assignments || [];
  const suggestions: any[] = data.ps_suggestions || [];
  const scores: any[] = data.problemsets || [];
  const blogs: any[] = data.blog_posts || [];
  const deadlines: any[] = (classes?.deadlines || []).slice(0, 6);

  const profile = user.username
    ? `<div class="card profile">
        <div class="row">
          <div class="avatar">${escapeHtml((user.full_name || user.username || "?").slice(0, 1))}</div>
          <div><b>${escapeHtml(user.full_name || user.username)}</b><br/>
          <span class="dim">@${escapeHtml(user.username)}${user.email ? " · " + escapeHtml(user.email) : ""}</span></div>
        </div>
        ${data.profile_progress !== undefined ? bar(data.profile_progress, "تکمیل پروفایل") : ""}
        ${data.college_users_count ? `<div class="dim">${faNum(Number(data.college_users_count).toLocaleString("en-US"))} یادگیرنده در کوئرا کالج</div>` : ""}
      </div>`
    : "";

  const collegesHtml = colleges.length
    ? colleges.map((c) => `
        <div class="item">
          ${link(escapeHtml(c.name), "cmd:queracode.openCourse", c.id)}
          <span class="dim"> · ${c.remaining_assignments !== undefined ? faNum(c.remaining_assignments) : "؟"} تمرین باقی‌مانده</span>
          ${bar(c.passed_percent ?? 0, "پیشرفت شما")}
        </div>`).join("")
    : `<div class="dim">کالج فعالی ندارید.</div>`;

  const classesHtml = classList.length
    ? classList.map((c) => `
        <div class="item">
          ${link(escapeHtml(c.name), "cmd:queracode.openCourse", c.id)}
          <span class="dim"> ${escapeHtml(c.instructor || "")}${c.qa?.term ? " · " + escapeHtml(c.qa.term) : ""}</span><br/>
          ${c.last_assignment ? `<span class="dim">آخرین تمرین: ${link(escapeHtml(c.last_assignment.name), "cmd:queracode.openLesson", c.last_assignment.id)}</span>` : ""}
        </div>`).join("")
    : `<div class="dim">کلاسی پیدا نشد.</div>`;

  const deadlinesHtml = deadlines.length
    ? deadlines.map((dl) => `
        <div class="item">
          <b>${escapeHtml(dl.name)}</b> <span class="dim">· ${escapeHtml(dl.course_name || "")}</span><br/>
          <span class="dim">مهلت: ${escapeHtml(String(dl.finish_time || "").replace("T", " ").slice(0, 16))}</span><br/>
          ${(dl.problems || []).map((p: any) =>
            link(`${escapeHtml(p.name)} ${p.state === "NO_SUBMIT" ? "•" : "✓"}`, "cmd:queracode.openProblem", p.id, "chip")).join(" ")}
        </div>`).join("")
    : `<div class="dim">مهلت نزدیکی ندارید.</div>`;

  const contestsHtml = contests.length
    ? contests.map((c) => `
        <div class="item"><b>${escapeHtml(c.name)}</b><br/>
        <span class="dim">${escapeHtml(c.start_time || "")} · ${faNum(c.participants ?? 0)} شرکت‌کننده</span></div>`).join("")
    : `<div class="dim">مسابقهٔ پیش‌رویی نیست.</div>`;

  const suggestionsHtml = suggestions.length
    ? suggestions.map((s) =>
        link(`${escapeHtml(s.level || "")}: ${escapeHtml(s.problem?.name || "?")}`,
          "cmd:queracode.openProblem", s.problem?.id, "chip big")).join(" ")
    : `<div class="dim">پیشنهادی نیست.</div>`;

  const scoresHtml = scores.length
    ? scores.map((p) => `<span class="chip">${escapeHtml(p.name)} · ${p.score}</span>`).join(" ")
    : "";

  const blogsHtml = blogs.length
    ? blogs.map((b) => `<div class="item"><a href="${escapeHtml(b.url)}">${escapeHtml(b.title)}</a> <span class="dim">${escapeHtml(b.time || "")}</span></div>`).join("")
    : "";

  return `
    <div class="actions wrap">${actionButtons(signedIn)}</div>
    <div class="grid">
      ${profile}
      ${card("کالج‌ها", art.learning, collegesHtml)}
      ${card("کلاس‌ها", art.learning, classesHtml)}
      ${card("مهلت‌ها", undefined, deadlinesHtml)}
      ${card("مسابقات", art.contest, contestsHtml)}
      ${card("پیشنهاد تمرین", art.standings, `${suggestionsHtml}<div class="scores">${scoresHtml}</div>`)}
      ${blogsHtml ? card("بلاگ کوئرا", undefined, blogsHtml) : ""}
    </div>`;
}

function wireMessages(p: vscode.WebviewPanel): void {
  p.webview.onDidReceiveMessage((msg) => {
    if (typeof msg?.type === "string" && msg.type.startsWith("cmd:")) {
      const command = msg.type.slice(4);
      vscode.commands.executeCommand(command, ...(msg.arg !== undefined ? [msg.arg] : []));
    }
  });
}

export async function openDashboard(service: QueraService): Promise<void> {
  const s = getSettings();
  if (panel) {
    panel.reveal();
  } else {
    panel = brandPanel(vscode.window.createWebviewPanel(
      "queracode.dashboard",
      "داشبورد کوئرا",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    ));
    panel.onDidDispose(() => (panel = undefined));
    wireMessages(panel);
  }
  panel.webview.html = pageShell("داشبورد کوئرا", PULSE_LOADER, s, { subtitle: "quera.org/dashboard", fontsBase: fontsBase(panel.webview), katexBase: katexBase(panel.webview) });
  const signedIn = await service.isSignedIn();
  if (!signedIn) {
    panel.webview.html = pageShell(
      "داشبورد کوئرا",
      `<div class="card center">
         ${(() => {
           const art = mediaUri(panel!.webview, "illustrations", "quera-dev.png");
           return art ? `<div class="hero"><img src="${art}" alt="کوئرا در VS Code" /></div>` : "";
         })()}
         <h3>به QueraCode خوش آمدید</h3>
         <p class="dim">برای دیدن داشبورد وارد شوید — کالج‌ها، کلاس‌ها، مهلت‌ها و مسابقات.</p>
         <div class="actions wrap center-actions">${actionButtons(false)}</div>
       </div>`,
      s,
      {
        script: DELEGATE_SCRIPT,
        fontsBase: fontsBase(panel.webview), katexBase: katexBase(panel.webview),
        cspSource: panel.webview.cspSource,
      }
    );
    return;
  }
  try {
    const client = await service.getClient();
    const [dash, classes] = await Promise.all([
      client.getDashboard(),
      client.getClasses().catch(() => ({ total: 0, items: [], deadlines: [] })),
    ]);
    if (panel) {
      const art = {
        learning: illustration(panel.webview, "learning"),
        contest: illustration(panel.webview, "contest"),
        standings: illustration(panel.webview, "standings"),
      };
      panel.webview.html = pageShell("داشبورد کوئرا", renderDashboard(dash, classes, true, art), s, {
        subtitle: dash.user?.username ? `@${dash.user.username}` : "quera.org/dashboard",
        script: DELEGATE_SCRIPT,
        fontsBase: fontsBase(panel.webview), katexBase: katexBase(panel.webview),
        cspSource: panel.webview.cspSource,
      });
    }
  } catch (e: any) {
    if (panel) {
      panel.webview.html = pageShell(
        "داشبورد کوئرا",
        `<div class="card"><h3>بارگذاری داشبورد ممکن نشد</h3>
         <p class="dim">${escapeHtml(e?.message || String(e))}</p>
         <div class="actions">${btn("تلاش دوباره", "cmd:queracode.openDashboard")}${btn("ورود دوباره", "cmd:queracode.login", undefined, "secondary")}</div></div>`,
        s,
        { script: DELEGATE_SCRIPT, fontsBase: fontsBase(panel.webview), katexBase: katexBase(panel.webview) }
      );
    }
  }
}
