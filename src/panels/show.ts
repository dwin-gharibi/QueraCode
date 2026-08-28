import * as vscode from "vscode";
import { getSettings, problemUrl } from "../config";
import type { JudgeResult } from "../submit";
import { DIFFICULTIES, outcomeOf, verdictOf } from "../constants";
import type { ProblemDetail } from "../api/types";
import { btnIcon, DELEGATE_SCRIPT, escapeHtml, faDateTime, faNum, faPercent, pageShell, PULSE_LOADER, renderMarkdown } from "./render";
import { brandPanel, fontsBase, katexBase, loadAnnotations, saveAnnotations } from "./webviewEnv";
import type { Finding } from "../validation";

export function showLoading(viewType: string, title: string): vscode.WebviewPanel {
  const s = getSettings();
  const panel = brandPanel(vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  }));
  panel.webview.html = pageShell(title, PULSE_LOADER, s, { fontsBase: fontsBase(panel.webview), katexBase: katexBase(panel.webview) });
  return panel;
}

export function showProblem(problem: ProblemDetail, existing?: vscode.WebviewPanel): void {
  const s = getSettings();
  const panel =
    existing ??
    brandPanel(vscode.window.createWebviewPanel(
      "queracode.problem",
      problem.name || `Problem ${problem.pk}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    ));
  panel.title = problem.name || `Problem ${problem.pk}`;
  const diff = DIFFICULTIES.find((d) => d.code === problem.difficulty);
  const chips = [
    diff ? `<span class="chip diff-${problem.difficulty}">${diff.en} · ${diff.fa}</span>` : "",
    problem.score !== undefined ? `<span class="chip">${faNum(problem.score)} نمره</span>` : "",
    problem.gained_score !== undefined
      ? `<span class="chip ${problem.gained_score >= (problem.score ?? Infinity) ? "diff-EASY" : "diff-MEDIUM"}">امتیاز شما: ${faNum(problem.gained_score)}${problem.score !== undefined ? ` از ${faNum(problem.score)}` : ""}</span>`
      : "",
    problem.solved_count !== undefined ? `<span class="chip">✓ ${faNum(problem.solved_count)} حل‌شده</span>` : "",
    ...(problem.tags || []).map((t) => `<span class="chip">#${escapeHtml(t.name)}</span>`),
  ].join("");
  const canTarget = !!problem.assignment?.pk;
  const fileTypeChips = (problem.allowed_file_types || [])
    .map((f) => `<span class="chip">${escapeHtml(f.label)}${f.extension ? ` (${escapeHtml(f.extension)})` : ""}</span>`)
    .join("");
  const subs = problem.submissions?.items || [];
  const historyRows = subs.slice(0, 8).map((sm: any) => {

    const o = outcomeOf(sm);
    const cls = o.accepted ? "ok" : o.pending ? "warn" : o.partial ? "warn" : "bad";
    return `<tr>
      <td class="nowrap">${escapeHtml(faDateTime(sm.submit_time))}</td>
      <td>${escapeHtml(String(sm.problem_name || problem.name || ""))}</td>
      <td>${escapeHtml(String(sm.file_type || ""))}</td>
      <td><span class="verdict ${cls}">${escapeHtml(o.fa)}</span>${
        o.score !== undefined ? ` <span class="chip">${faPercent(o.score)}</span>` : ""
      }</td>
      <td>${sm.pk ? `<button class="secondary" data-cmd="result" data-arg="${Number(sm.pk)}">نتیجهٔ داوری</button>` : ""}</td>
    </tr>`;
  }).join("");
  const historySection = historyRows
    ? `<div class="q-divider">ارسال‌های من</div>
       <div class="table-wrap"><table class="mdtable">
         <thead><tr><th>زمان</th><th>تمرین</th><th>نوع فایل</th><th>نتیجه</th><th></th></tr></thead>
         <tbody>${historyRows}</tbody>
       </table></div>`
    : "";
  const submitSection = `
    <div class="q-divider">ارسال پاسخ برای این سؤال</div>
    <div class="submitbox">
      ${problem.can_submit === false && problem.submit_note
        ? `<div class="note closed">${escapeHtml(problem.submit_note)}</div>`
        : `<div class="note">پاسخ خود را مستقیم از VS Code ارسال کنید — فایل فعال یا یک فایل انتخابی.</div>`}
      ${fileTypeChips ? `<div class="meta">${fileTypeChips}</div>` : ""}
      <div class="actions">
        ${canTarget ? btnIcon("rocket", "ارسال فایل فعال", "submitHere") : ""}
        ${canTarget ? btnIcon("upload", "انتخاب فایل و ارسال…", "submitPick", "secondary") : ""}
        ${btnIcon("play", "اجرای تست‌های نمونه", "samples", "secondary")}
        ${btnIcon("globe", "مشاهده در کوئرا", "openWeb", "secondary")}
      </div>
    </div>
    ${historySection}`;

  const solved = problem.gained_score !== undefined
    && problem.score !== undefined
    && problem.gained_score >= problem.score;
  const attempted = (problem.submissions?.items || []).length > 0;
  const nextStep = solved
    ? { icon: "search", label: "تمرین بعدی را پیدا کنید", cmd: "next",
        note: "این تمرین را کامل حل کرده‌اید." }
    : attempted
      ? { icon: "play", label: "اجرای نمونه‌ها", cmd: "samples",
          note: "قبلاً ارسال داشته‌اید — پیش از ارسال بعدی، نمونه‌ها را اجرا کنید." }
      : { icon: "edit", label: "شروع حل", cmd: "solve",
          note: "یک فایل راه‌حل در زبان دلخواه ساخته می‌شود." };

  const body = `
    <div class="nextstep">
      <div class="nextstep-copy">
        <span class="nextstep-kicker">گام بعدی</span>
        <span class="dim">${escapeHtml(nextStep.note)}</span>
      </div>
      ${btnIcon(nextStep.icon, nextStep.label, nextStep.cmd)}
    </div>
    <div class="actions">
      ${nextStep.cmd !== "solve" ? btnIcon("edit", "حل تمرین", "solve", "secondary") : ""}
      ${canTarget ? btnIcon("rocket", "ارسال فایل فعال", "submitHere", "secondary") : ""}
      ${btnIcon("save", "ذخیرهٔ محلی", "save", "secondary")}
      ${canTarget ? btnIcon("download", "پروژهٔ اولیه", "download", "secondary") : ""}
      ${nextStep.cmd !== "samples" ? btnIcon("play", "اجرای نمونه‌ها", "samples", "secondary") : ""}
      ${btnIcon("sparkle", "توضیح با AI", "ai", "secondary")}
      ${btnIcon("globe", "مشاهده در کوئرا", "openWeb", "secondary")}
    </div>
    <div class="meta">${chips}</div>
    ${renderMarkdown(problem.description || "_No statement available._")}
    ${submitSection}`;
  const origin = problem.assignment?.pk
    ? `problem #${problem.pk} · ${problem.area === "contest" ? "contest" : "assignment"} #${problem.assignment.pk}`
    : `problemset #${problem.pk}`;
  panel.webview.html = pageShell(problem.name || `#${problem.pk}`, body, s, {
    subtitle: origin,
    script: DELEGATE_SCRIPT,
    fontsBase: fontsBase(panel.webview), katexBase: katexBase(panel.webview),
  });
  const webUrl = problemUrl(problem.pk, problem.area, problem.assignment?.pk);
  panel.webview.onDidReceiveMessage((msg) => {
    if (msg.type === "solve") vscode.commands.executeCommand("queracode.solveProblem", problem);
    else if (msg.type === "submitHere") vscode.commands.executeCommand("queracode.submitFileToProblem", problem);
    else if (msg.type === "submitPick") vscode.commands.executeCommand("queracode.submitFileToProblem", problem, true);
    else if (msg.type === "save") vscode.commands.executeCommand("queracode.saveProblem", problem);
    else if (msg.type === "download") vscode.commands.executeCommand("queracode.downloadInitProject", problem);
    else if (msg.type === "samples") vscode.commands.executeCommand("queracode.runSamples", problem);
    else if (msg.type === "ai") vscode.commands.executeCommand("queracode.ai.explainProblem", problem.pk);
    else if (msg.type === "openWeb") vscode.env.openExternal(vscode.Uri.parse(webUrl));
    else if (msg.type === "result") vscode.commands.executeCommand("queracode.viewSubmissionResult", Number(msg.arg));
    else if (msg.type === "next") vscode.commands.executeCommand("queracode.searchProblems");
  });
}

export function showResult(
  title: string,
  verdictCode: string,
  score: number | undefined,
  tests: any[],
  judge?: JudgeResult
): void {
  const s = getSettings();
  const panel = brandPanel(vscode.window.createWebviewPanel(
    "queracode.result", title, vscode.ViewColumn.Beside, { enableScripts: false }));

  const rowsFrom = judge?.tests?.length
    ? judge.tests.map((t) =>
        `<tr class="${t.accepted ? "ok" : "bad"}"><td>${t.index}</td>` +
        `<td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.status)}</td></tr>`)
    : (tests || []).map((t: any, i: number) =>
        `<tr><td>${i + 1}</td><td>Test ${i + 1}</td>` +
        `<td>${escapeHtml(String(t.status ?? t.result ?? t.verdict ?? "?"))}</td></tr>`);

  const scored = (verdictCode || "").toUpperCase() === "S";
  const effective = (judge?.verdict && (verdictCode === "NJ" || scored)) ? judge.verdict : verdictCode;
  const v = verdictOf(effective);

  type State = "judged" | "no-tests" | "compile-error" | "queued";
  const state: State = rowsFrom.length
    ? "judged"
    : judge?.compile && /error|fail/i.test(judge.compile)
      ? "compile-error"
      : /no test/i.test(judge?.note || "")
        ? "no-tests"
        : "queued";

  const accepted = judge ? judge.accepted : !!v?.accepted;
  const HEADLINE: Record<State, { cls: string; en: string; fa: string; hint: string }> = {
    judged: {
      cls: accepted ? "ok" : "bad",
      en: v?.en || effective,
      fa: v?.fa || "",
      hint: accepted
        ? "همهٔ تست‌ها را گذراندید."
        : "تست‌های قرمز پایین را ببینید؛ اولین تست ناموفق معمولاً علت را نشان می‌دهد.",
    },
    "no-tests": {
      cls: "warn",
      en: "No tests configured",
      fa: "تستی برای این سؤال تعریف نشده",
      hint: "ارسال شما ثبت شد، اما این سؤال هنوز هیچ تستی ندارد — پس نمره‌ای هم محاسبه نمی‌شود. این ایراد سؤال است، نه پاسخ شما.",
    },
    "compile-error": {
      cls: "bad",
      en: "Compile error",
      fa: "خطای کامپایل",
      hint: "کد شما اجرا نشد. پیام کامپایلر پایین آمده است.",
    },
    queued: {
      cls: "warn",
      en: "Waiting for the judge",
      fa: "در صف داوری",
      hint: "کوئرا هنوز نتیجه‌ای برنگردانده است. چند لحظه بعد دوباره باز کنید.",
    },
  };
  const head = HEADLINE[state];

  const passRatio = judge?.total ? Math.round((judge.passed / judge.total) * 100) : undefined;
  const stats = [
    score !== undefined ? `<div class="stat"><b>${faNum(score)}</b><span>نمره</span></div>` : "",
    judge?.total
      ? `<div class="stat"><b>${faNum(judge.passed)}/${faNum(judge.total)}</b><span>تست قبول‌شده</span></div>` : "",
    passRatio !== undefined
      ? `<div class="stat"><b>${faPercent(passRatio)}</b><span>موفقیت</span></div>` : "",
  ].filter(Boolean).join("");

  const compile = judge?.compile
    ? `<div class="q-divider">خروجی کامپایلر</div><pre class="code" data-lang="compiler"><code>${escapeHtml(judge.compile)}</code></pre>`
    : "";

  const body = `
    <div class="resulthead ${head.cls}">
      <div class="verdict ${head.cls}">${escapeHtml(head.en)}${head.fa ? ` · ${escapeHtml(head.fa)}` : ""}</div>
      <p class="dim">${escapeHtml(head.hint)}</p>
      ${stats ? `<div class="stats">${stats}</div>` : ""}
    </div>
    ${compile}
    ${rowsFrom.length
      ? `<div class="q-divider">نتیجهٔ تست‌ها</div>
         <div class="table-wrap"><table class="results">
           <thead><tr><th>#</th><th>تست</th><th>وضعیت</th></tr></thead>
           <tbody>${rowsFrom.join("")}</tbody>
         </table></div>`
      : judge?.note && state !== "no-tests"
        ? `<div class="finding warning">${escapeHtml(judge.note)}</div>`
        : ""}`;
  panel.webview.html = pageShell(title, body, s, {
    subtitle: `submission · ${effective}`,
    fontsBase: fontsBase(panel.webview), katexBase: katexBase(panel.webview),
  });
}

export interface LessonNav {
  collegeId: number;
  chapterId: number;
  lessonId: number;
  name: string;
}

export function showPreview(
  title: string,
  markdown: string,
  opts?: { annotKey?: string; prev?: LessonNav; next?: LessonNav; localRoot?: vscode.Uri }
): void {
  const s = getSettings();
  const panel = brandPanel(vscode.window.createWebviewPanel(
    "queracode.preview", title, vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: opts?.localRoot ? [opts.localRoot] : undefined,
    }
  ));
  const localBase = opts?.localRoot
    ? panel.webview.asWebviewUri(opts.localRoot).toString()
    : undefined;
  const words = (markdown.match(/\S+/g) || []).length;
  const minutes = Math.max(1, Math.round(words / 180));
  const annotKey = opts?.annotKey || title;
  const saved = loadAnnotations(annotKey);
  const navBtns = [
    opts?.prev ? `<button class="secondary" data-act="navPrev">‹ ${escapeHtml(opts.prev.name)}</button>` : "",
    opts?.next ? `<button class="secondary" data-act="navNext">${escapeHtml(opts.next.name)} ›</button>` : "",
  ].join("");
  const body = `
    <div id="qprogress"></div>
    <div class="actions previewbar">
      <button class="secondary" data-act="dir">⇄ RTL/LTR</button>
      <button class="secondary" data-act="bigger">A+</button>
      <button class="secondary" data-act="smaller">A−</button>
      <button class="secondary" data-act="toc">☰ فهرست</button>
      <button class="secondary" data-act="clearAnnots">پاک‌کردن نشانه‌ها</button>
      <span class="chip">${faNum(minutes)} دقیقه مطالعه</span>
    </div>
    <nav id="toc" class="card" hidden></nav>
    <div id="qbody">${renderMarkdown(markdown, localBase)}</div>
    ${navBtns ? `<div class="actions">${navBtns}</div>` : ""}
    <div id="qhint" class="dim">متنی را انتخاب کنید تا «هایلایت» یا «یادداشت» کنید — نشانه‌ها ذخیره می‌شوند.</div>
    <div id="qmenu" hidden><button data-annot="hl">هایلایت</button><button data-annot="note">یادداشت</button></div>`;
  const script = `
    const vsc = acquireVsCodeApi();
    const body = document.getElementById("qbody");
    const toc = document.getElementById("toc");
    const qmenu = document.getElementById("qmenu");
    const progress = document.getElementById("qprogress");
    let size = ${Math.max(10, Math.min(24, s.fontSize || 14.5))};
    let annots = ${JSON.stringify(saved)};
    for (const pre of document.querySelectorAll("pre.code")) {
      const btn = document.createElement("button");
      btn.textContent = "copy";
      btn.className = "copybtn";
      btn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(pre.querySelector("code").innerText); btn.textContent = "✓ copied"; }
        catch { btn.textContent = "select+copy"; }
        setTimeout(() => (btn.textContent = "copy"), 1400);
      });
      pre.appendChild(btn);
    }
    const heads = [...body.querySelectorAll("h2, h3")];
    heads.forEach((h, i) => (h.id = "h" + i));
    toc.innerHTML = heads.map((h, i) =>
      '<a class="toc-' + h.tagName.toLowerCase() + '" href="#h' + i + '">' + h.textContent + "</a>").join("");
    document.addEventListener("scroll", () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      progress.style.width = (max > 0 ? Math.min(100, 100 * scrollY / max) : 0) + "%";
    }, { passive: true });
    const persist = () => vsc.postMessage({ type: "annots", data: annots });
    function wrapFirst(text, cls, note) {
      if (!text) return;
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const at = n.textContent.indexOf(text);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(n, at); range.setEnd(n, at + text.length);
        const mark = document.createElement("mark");
        mark.className = cls;
        if (note) { mark.title = note; mark.classList.add("q-note"); }
        try { range.surroundContents(mark); } catch { /* crosses elements — skip */ }
        return;
      }
    }
    for (const a of annots) wrapFirst(a.text, a.kind === "note" ? "blue" : "yellow", a.note);
    let pendingText = "";
    document.addEventListener("mouseup", () => {
      const sel = getSelection();
      const text = sel && sel.toString().trim();
      if (!text || text.length < 2 || !body.contains(sel.anchorNode)) { qmenu.hidden = true; return; }
      pendingText = text.slice(0, 300);
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      qmenu.style.top = (scrollY + rect.top - 42) + "px";
      qmenu.style.left = (scrollX + rect.left) + "px";
      qmenu.hidden = false;
    });
    qmenu.addEventListener("click", (e) => {
      const kind = e.target && e.target.dataset ? e.target.dataset.annot : null;
      if (!kind || !pendingText) return;
      let note;
      if (kind === "note") {
        note = (prompt && prompt("یادداشت شما:")) || "";
        if (!note) { qmenu.hidden = true; return; }
      }
      annots.push({ kind, text: pendingText, note });
      wrapFirst(pendingText, kind === "note" ? "blue" : "yellow", note);
      qmenu.hidden = true;
      getSelection().removeAllRanges();
      persist();
    });
    document.addEventListener("click", (e) => {
      const el = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!el) return;
      const act = el.dataset.act;
      if (act === "dir") document.body.dir = document.body.dir === "rtl" ? "ltr" : "rtl";
      else if (act === "bigger") { size += 1; document.body.style.fontSize = size + "px"; }
      else if (act === "smaller") { size = Math.max(10, size - 1); document.body.style.fontSize = size + "px"; }
      else if (act === "toc") toc.hidden = !toc.hidden;
      else if (act === "navPrev") vsc.postMessage({ type: "navPrev" });
      else if (act === "navNext") vsc.postMessage({ type: "navNext" });
      else if (act === "clearAnnots") {
        annots = [];
        persist();
        for (const m of [...body.querySelectorAll("mark.yellow, mark.blue")]) {
          m.replaceWith(...m.childNodes);
        }
      }
    });`;
  panel.webview.html = pageShell(title, body, s, {
    script, fontsBase: fontsBase(panel.webview), katexBase: katexBase(panel.webview),
    cspSource: panel.webview.cspSource,
  });
  panel.webview.onDidReceiveMessage((msg) => {
    if (msg.type === "annots") saveAnnotations(annotKey, msg.data || []);
    else if (msg.type === "navPrev" && opts?.prev) {
      vscode.commands.executeCommand("queracode.readCollegeLesson",
        opts.prev.collegeId, opts.prev.chapterId, opts.prev.lessonId, opts.prev.name);
    } else if (msg.type === "navNext" && opts?.next) {
      vscode.commands.executeCommand("queracode.readCollegeLesson",
        opts.next.collegeId, opts.next.chapterId, opts.next.lessonId, opts.next.name);
    }
  });
}

export function showFindings(title: string, findings: Finding[], warnings: string[] = []): void {
  const s = getSettings();
  const panel = brandPanel(vscode.window.createWebviewPanel(
    "queracode.validation", title, vscode.ViewColumn.Beside, { enableScripts: false }));
  const errCount = findings.filter((f) => f.severity === "error").length;
  const body = `
    <div class="meta">
      <span class="verdict ${errCount ? "bad" : "ok"}">${errCount ? `${errCount} error(s)` : "Clean"}</span>
      <span class="chip">${findings.length - errCount} warning(s)</span>
    </div>
    ${findings.map((f) => `<div class="finding ${f.severity}">L${f.line} · [${f.rule}] ${escapeHtml(f.message)}</div>`).join("")}
    ${warnings.map((w) => `<div class="finding warning">${escapeHtml(w)}</div>`).join("")}
    ${!findings.length && !warnings.length ? "<p>✓ No issues found.</p>" : ""}`;
  panel.webview.html = pageShell(title, body, s, { fontsBase: fontsBase(panel.webview), katexBase: katexBase(panel.webview) });
}
