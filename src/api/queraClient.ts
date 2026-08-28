import type { Course, DownloadResult, ProblemDetail, ProblemPage } from "./types";

const CSRF_FALLBACK_PAGE = "problemset";

const MIN_REQUEST_INTERVAL_MS = 400;
const MAX_REQUEST_INTERVAL_MS = 8000;
const THROTTLE_COOLDOWN_MS = 45000;

class HostPacer {
  private interval = MIN_REQUEST_INTERVAL_MS;
  private nextAllowed = 0;
  private successes = 0;

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      if (now >= this.nextAllowed) {
        this.nextAllowed = now + this.interval;
        return;
      }
      await new Promise((r) => setTimeout(r, this.nextAllowed - now));
    }
  }

  penalize(retryAfterMs?: number): void {
    this.successes = 0;
    this.interval = Math.min(MAX_REQUEST_INTERVAL_MS, this.interval * 2);
    const cooldown = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : THROTTLE_COOLDOWN_MS;
    this.nextAllowed = Math.max(this.nextAllowed, Date.now() + cooldown);
  }

  succeed(): void {
    if (this.interval <= MIN_REQUEST_INTERVAL_MS) return;
    if (++this.successes >= 12) {
      this.successes = 0;
      this.interval = Math.max(MIN_REQUEST_INTERVAL_MS, this.interval * 0.75);
    }
  }
}

const pacers = new Map<string, HostPacer>();
function pacerFor(host: string): HostPacer {
  let pacer = pacers.get(host);
  if (!pacer) { pacer = new HostPacer(); pacers.set(host, pacer); }
  return pacer;
}

export function isRateLimited(status: number, body: string): boolean {
  if (status === 429) return true;
  return status === 200 && body.slice(0, 4000).includes("به کجا چنین شتابان");
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export interface ClientOptions {
  baseUrl: string;
  sessionId?: string;
  csrfToken?: string;
  username?: string;
  password?: string;
  locale?: string;
  timeoutMs?: number;
}

export class QueraError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "QueraError";
  }
}

const LOGIN_API_PATH = "accounts/api/login/";
const LOGIN_VERIFY_PATH = "accounts/api/login/verify";

export async function describeLoginFailure(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  try {
    const body = JSON.parse(raw);
    const messages: string[] = [];
    for (const value of Object.values(body as Record<string, unknown>)) {
      if (typeof value === "string") messages.push(value);
      else if (Array.isArray(value)) messages.push(...value.filter((v) => typeof v === "string"));
    }
    if (messages.length) return messages.join(" ");
    if (typeof body?.detail === "string") return body.detail;
  } catch {
  }
  return `Quera returned HTTP ${res.status} and set no session cookie.`;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

interface ParsedForm {
  action: string;
  fields: Map<string, string>;
  fileFields: string[];
  passwordField?: string;
  identityField?: string;
}

function parseForm(html: string): ParsedForm | undefined {
  let best: ParsedForm | undefined;
  for (const fm of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = fm[1];
    const inner = fm[2];
    const form: ParsedForm = {
      action: attrs.match(/action="([^"]*)"/i)?.[1] || "",
      fields: new Map(),
      fileFields: [],
    };
    for (const inp of inner.matchAll(/<input\b([^>]*)>/gi)) {
      const a = inp[1];
      const name = a.match(/name="([^"]*)"/i)?.[1];
      if (!name) continue;
      const type = (a.match(/type="([^"]*)"/i)?.[1] || "text").toLowerCase();
      if (type === "file") { form.fileFields.push(name); continue; }
      if (["submit", "button", "image", "reset"].includes(type)) continue;
      if (type === "radio" || type === "checkbox") {
        if (/\bchecked\b/i.test(a)) form.fields.set(name, a.match(/value="([^"]*)"/i)?.[1] ?? "on");
        continue;
      }
      if (type === "password" && !form.passwordField) form.passwordField = name;
      else if (["text", "email", "tel"].includes(type) && !form.identityField && name !== "csrfmiddlewaretoken") form.identityField = name;
      form.fields.set(name, decodeHtmlEntities(a.match(/value="([^"]*)"/i)?.[1] ?? ""));
    }
    for (const ta of inner.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
      const name = ta[1].match(/name="([^"]*)"/i)?.[1];
      if (name) form.fields.set(name, decodeHtmlEntities(ta[2]));
    }
    for (const sel of inner.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      const name = sel[1].match(/name="([^"]*)"/i)?.[1];
      if (!name) continue;
      const val = sel[2].match(/<option[^>]*\bselected\b[^>]*value="([^"]*)"/i)?.[1]
        ?? sel[2].match(/<option[^>]*value="([^"]*)"/i)?.[1] ?? "";
      form.fields.set(name, val);
    }
    if (form.fields.has("description")) return form;
    if (!best || form.fields.size > best.fields.size) best = form;
  }
  return best;
}

export function extractNextData(html: string): any | undefined {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
}

export function flattenConnection(value: any): any {
  if (value && Array.isArray(value.edges)) {
    const items = value.edges.filter((e: any) => e && "node" in e).map((e: any) => e.node);
    const out: any = { items };
    if ("totalCount" in value) out.total = value.totalCount;
    return out;
  }
  return value;
}

function asId(v: any): any {
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return v;
}

export function normalizeProblem<T extends Record<string, any>>(p: T): T {
  if (!p || typeof p !== "object") return p;
  if ("pk" in p) (p as any).pk = asId(p.pk);
  if (p.assignment && "pk" in p.assignment) p.assignment.pk = asId(p.assignment.pk);
  if (Array.isArray(p.allowed_file_types)) {
    for (const ft of p.allowed_file_types) if (ft && "id" in ft) ft.id = asId(ft.id);
  }
  if (Array.isArray(p.tags)) {
    for (const t of p.tags) if (t && "id" in t) t.id = asId(t.id);
  }
  const subs = p.submissions?.items;
  if (Array.isArray(subs)) for (const s of subs) if (s && "pk" in s) s.pk = asId(s.pk);
  return p;
}

export interface AssignmentItem {
  id: number;
  name: string;
  score?: number;
  kind?: "problem" | "lesson";
}

function toAsciiDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => {
    const fa = "۰۱۲۳۴۵۶۷۸۹".indexOf(d);
    return String(fa >= 0 ? fa : "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  });
}

export function parseProblemUrl(
  input: string
): { kind: "problemset" | "assignment"; problemId: number; assignmentId?: number; area?: "course" | "contest" } | undefined {
  const s = (input || "").trim();
  if (/^\d+$/.test(s)) return { kind: "problemset", problemId: Number(s) };
  const ps = s.match(/problemset\/(\d+)/);
  if (ps) return { kind: "problemset", problemId: Number(ps[1]) };
  const asg = s.match(/(course|contest|college)\/assignments\/(\d+)\/(?:problems|edit_problem)\/(\d+)/);
  if (asg) {
    return {
      kind: "assignment",
      assignmentId: Number(asg[2]),
      problemId: Number(asg[3]),
      area: asg[1] === "contest" ? "contest" : "course",
    };
  }
  return undefined;
}

export function parseProblemLinks(html: string): AssignmentItem[] {
  const items: AssignmentItem[] = [];
  const seen = new Set<number>();
  const linkRe = /<a[^>]+href="([^"]*\/problems\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const id = Number(m[2]);
    if (seen.has(id)) continue;
    const inner = m[3];
    let score: number | undefined;
    const label = inner.match(/data-content='?نمره'?[^>]*>\s*([0-9۰-۹٠-٩]+)/u);
    if (label) score = Number(toAsciiDigits(label[1]));
    let name = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const trailing = name.match(/\s+([0-9۰-۹٠-٩]+)$/u);
    if (trailing) {
      if (score === undefined) score = Number(toAsciiDigits(trailing[1]));
      name = name.slice(0, trailing.index).trim() || name;
    }
    if (!name) continue;
    seen.add(id);
    items.push({ id, name: decodeHtmlEntities(name), score, kind: score !== undefined ? "problem" : "lesson" });
  }
  return items;
}

export function extractDivById(html: string, id: string): string | undefined {
  const open = html.match(new RegExp(`<div\\b[^>]*id="${id}"[^>]*>`));
  if (!open || open.index === undefined) return undefined;
  const start = open.index + open[0].length;
  let depth = 1;
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = start;
  let t: RegExpExecArray | null;
  while ((t = re.exec(html))) {
    depth += t[0][1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(start, t.index);
  }
  return html.slice(start);
}

export interface LmsProblemPage {
  name?: string;
  description?: string;
  canSubmit: boolean;
  submitNote?: string;
  fileTypes?: { id: number; label: string }[];
  siblings: AssignmentItem[];
}

export function parseLmsProblemPage(html: string, problemId: number): LmsProblemPage {
  const raw = extractDivById(html, `description_md-${problemId}`);
  const description = raw !== undefined ? decodeHtmlEntities(raw).trim() : undefined;
  const siblings = parseProblemLinks(html);
  let name = siblings.find((s) => s.id === problemId)?.name;
  if (!name) name = html.match(/<div class="text" title="([^"]+)"/)?.[1];
  if (!name) name = html.match(/<title>\s*([\s\S]*?)\s*<\/title>/)?.[1]?.split(" - ")[0]?.trim();
  const canSubmit = /id="submit-form"/.test(html);
  const note = html.match(/<div class="ui teal message">([\s\S]*?)<\/div>/)?.[1];
  const fileTypes: { id: number; label: string }[] = [];
  const sel = html.match(/<select[^>]*(?:id="id_file_type"|name="file_type")[^>]*>([\s\S]*?)<\/select>/i);
  if (sel) {
    for (const opt of sel[1].matchAll(/<option[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/gi)) {
      fileTypes.push({ id: Number(opt[1]), label: decodeHtmlEntities(opt[2].replace(/<[^>]+>/g, "").trim()) });
    }
  }
  return {
    name: name ? decodeHtmlEntities(name) : undefined,
    description,
    canSubmit,
    submitNote: note ? decodeHtmlEntities(note.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()) : undefined,
    fileTypes: fileTypes.length ? fileTypes : undefined,
    siblings,
  };
}

export function htmlToMarkdownLite(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(?:nav|header|footer|aside)\b[\s\S]*?<\/(?:nav|header|footer|aside)>/gi, "");
  const main = s.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || s.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (main) s = main[1];
  s = s
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => "\n```\n" + decodeHtmlEntities(c.replace(/<[^>]+>/g, "")) + "\n```\n")
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, c) => `\n${"#".repeat(Number(l))} ${c.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()}\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `\n- ${c.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()}`)
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|section|tr|table|ul|ol|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = decodeHtmlEntities(s);
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function parseSubmissionsTable(html: string): { pk: number; problem_id?: number;
  problem_name?: string; submit_time?: string; file_type?: string; judge_score?: number;
  is_final?: boolean }[] {
  const out: { pk: number; problem_id?: number; problem_name?: string; submit_time?: string;
    file_type?: string; judge_score?: number; is_final?: boolean }[] = [];
  const rowRe = /<tr\s+data-submission_id="(\d+)"([^>]*)>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const attrs = m[2];
    const body = m[3];
    const problemLink = body.match(/href="[^"]*\/problems\/(\d+)[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/a>/);
    const autoTds = [...body.matchAll(/<td dir="auto">\s*([\s\S]*?)\s*<\/td>/g)]
      .map((t) => decodeHtmlEntities(t[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()));
    const label = body.match(/show-submission-info"[^>]*data-action="get_result"[^>]*>\s*([\s\S]*?)\s*<\/a>/);
    const scoreText = label ? label[1].replace(/<[^>]+>/g, "").trim() : "";
    const score = scoreText ? Number(toAsciiDigits(scoreText).replace(/[^\d.-]/g, "")) : undefined;
    out.push({
      pk: Number(m[1]),
      problem_id: attrs.match(/data-problem_id="(\d+)"/)?.[1] ? Number(attrs.match(/data-problem_id="(\d+)"/)![1]) : undefined,
      problem_name: problemLink ? decodeHtmlEntities(problemLink[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()) : undefined,
      submit_time: autoTds[0],
      file_type: autoTds.length > 1 ? autoTds[autoTds.length - 1] : undefined,
      judge_score: Number.isFinite(score) ? score : undefined,
      is_final: /name="change_submit"[^>]*checked/.test(body),
    });
  }
  return out;
}

export function parseHtmlTable(html: string): string[][] {
  const t = html.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
  if (!t) return [];
  const rows: string[][] = [];
  for (const tr of t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      decodeHtmlEntities(c[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    );
    if (cells.length) rows.push(cells);
  }
  return rows;
}

export class QueraClient {
  private cookies = new Map<string, string>();
  private buildId?: string;
  private loggedIn = false;

  constructor(private readonly opts: ClientOptions) {
    if (opts.sessionId) {
      this.cookies.set("session_id", opts.sessionId);
      this.loggedIn = true;
    }
    if (opts.csrfToken) {
      this.cookies.set("csrf_token", opts.csrfToken);
      this.cookies.set("csrftoken", opts.csrfToken);
    }
  }

  private get base(): string {
    return this.opts.baseUrl.replace(/\/?$/, "/");
  }

  private get locale(): string {
    return this.opts.locale || "fa";
  }

  get authMethod(): "session_id" | "login" | "none" {
    if (this.opts.sessionId) return "session_id";
    if (this.opts.username && this.opts.password) return "login";
    return "none";
  }

  private cookieHeader(): string {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private storeCookies(res: Response): void {
    const anyHeaders = res.headers as any;
    let setCookies: string[] =
      typeof anyHeaders.getSetCookie === "function" ? anyHeaders.getSetCookie() : [];
    if (!setCookies.length) {
      const combined = res.headers.get("set-cookie");
      if (combined) setCookies = combined.split(/,(?=\s*[A-Za-z0-9_.-]+=)/);
    }
    for (const raw of setCookies) {
      const first = raw.split(";")[0];
      const eq = first.indexOf("=");
      if (eq > 0) this.cookies.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }

  private csrf(): string | undefined {
    return this.opts.csrfToken || this.cookies.get("csrf_token") || this.cookies.get("csrftoken");
  }

  private async ensureCsrf(pagePath: string): Promise<string | undefined> {
    const existing = this.csrf();
    if (existing) return existing;
    const candidates = [pagePath];
    if (pagePath !== CSRF_FALLBACK_PAGE) candidates.push(CSRF_FALLBACK_PAGE);
    for (let i = 0; i < candidates.length; i++) {
      const res = await this.request(candidates[i], { headers: { Accept: "text/html" } });
      if (i === candidates.length - 1) this.raiseFor(res, `fetch CSRF token from ${candidates[i]}`);
      else if (!res.ok && !(res.status >= 300 && res.status < 400)) continue;
      let token = this.cookies.get("csrftoken") || this.cookies.get("csrf_token");
      if (!token) {
        const html = await res.text();
        token = html.match(/name="csrfmiddlewaretoken"[^>]*value="([^"]+)"/)?.[1]
          || html.match(/"csrfToken"\s*:\s*"([^"]+)"/)?.[1] || undefined;
        if (token) this.cookies.set("csrftoken", token);
      }
      if (token) return token;
    }
    return undefined;
  }

  private async request(
    path: string,
    init: RequestInit & { query?: Record<string, string | string[]> } = {}
  ): Promise<Response> {
    const url = new URL(path.replace(/^\//, ""), this.base);
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
        else url.searchParams.set(k, v);
      }
    }
    const headers = new Headers(init.headers);
    headers.set("User-Agent", USER_AGENT);
    headers.set("X-Requested-With", "XMLHttpRequest");
    headers.set("Accept-Language", "en-US,en;q=0.9,fa;q=0.8");
    const cookie = this.cookieHeader();
    if (cookie) headers.set("Cookie", cookie);

    const method = (init.method || "GET").toUpperCase();
    const attempts = method === "GET" ? 3 : 1;
    const maxThrottles = 3;
    let throttles = 0;
    const pacer = pacerFor(new URL(this.base).host);
    let res: Response | undefined;
    for (let attempt = 1; attempt <= attempts; ) {
      await pacer.acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs || 30000);
      try {
        res = await fetch(url, { ...init, headers, redirect: "manual", signal: controller.signal });
      } catch (err: any) {
        attempt++;
        if (attempt > attempts) throw new QueraError(`Network error contacting Quera: ${err?.message || err}`);
        await new Promise((r) => setTimeout(r, 700 * attempt));
        continue;
      } finally {
        clearTimeout(timer);
      }

      const retryAfter = Number(res.headers.get("Retry-After"));
      const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 60000) : undefined;
      const body = (res.headers.get("Content-Type") || "").includes("text/html")
        ? await res.clone().text().catch(() => "") : "";
      if (isRateLimited(res.status, body)) {
        pacer.penalize(retryAfterMs);
        if (++throttles < maxThrottles) continue;
        throw new QueraError(
          "Quera's rate limiter is still refusing requests after " +
            `${throttles} paced attempts («به کجا چنین شتابان...»). Wait a minute and retry.`,
          429);
      }
      pacer.succeed();

      if (res.status >= 500 && attempt < attempts) {
        attempt++;
        await new Promise((r) => setTimeout(r, retryAfterMs ?? 900 * Math.pow(2, attempt - 1)));
        continue;
      }
      break;
    }
    this.storeCookies(res!);
    if (
      method !== "GET" &&
      (res!.status === 301 || res!.status === 308) &&
      !(init as any).__redirected
    ) {
      const location = res!.headers.get("Location");
      if (location) {
        const target = new URL(location, this.base);
        const rel = target.pathname.replace(/^\//, "") + target.search;
        return this.request(rel, { ...init, __redirected: true } as any);
      }
    }
    if (method === "GET" && res!.status >= 300 && res!.status < 400) {
      const location = res!.headers.get("Location");
      const hops = Number((init as any).__hops) || 0;
      const target = location ? new URL(location, url) : undefined;
      const toLogin = !!target && /\/accounts\/login/i.test(target.pathname);
      if (target && target.host === url.host && hops < 5 && !(toLogin && !(init as any).__authFlow)) {
        const rel = target.pathname.replace(/^\//, "") + target.search;
        return this.request(rel, { ...init, query: undefined, __hops: hops + 1 } as any);
      }
    }
    return res!;
  }

  private isLoginRedirect(res: Response): boolean {
    if (res.status < 300 || res.status >= 400) return false;
    return /accounts\/login/i.test(res.headers.get("Location") || "");
  }

  private raiseFor(res: Response, action: string): void {
    if (res.ok || (res.status >= 300 && res.status < 400)) return;
    if (res.status === 401 || res.status === 403) {
      throw new QueraError(
        `Authentication failed during ${action} (HTTP ${res.status}). The session may be missing/expired.`,
        res.status
      );
    }
    if (res.status === 429) {
      throw new QueraError(
        `Quera rate-limited this request (HTTP 429 during ${action}). ` +
          "It was retried automatically — wait a few seconds and try again.",
        429
      );
    }
    if (res.status === 404) {
      throw new QueraError(
        `Not found (HTTP 404) during ${action}. The id may not exist, may have ` +
          "been deleted, or may live in a course/contest you cannot access.",
        404
      );
    }
    throw new QueraError(`Quera returned HTTP ${res.status} during ${action}.`, res.status);
  }

  private raiseForLoginRedirect(res: Response, action: string): void {
    if (res.status < 300 || res.status >= 400) return;
    const location = res.headers.get("Location") || "";
    if (/accounts\/login/i.test(location)) {
      throw new QueraError(
        `Not signed in: Quera redirected ${action} to the login page. ` +
          "The session_id is missing or expired — run 'Quera: Sign In' again.",
        401
      );
    }
  }

  get sessionId(): string | undefined {
    return this.cookies.get("session_id");
  }

  get csrfToken(): string | undefined {
    return this.csrf();
  }

  async ensureLoggedIn(): Promise<void> {
    if (this.loggedIn) return;
    if (!(this.opts.username && this.opts.password)) {
      throw new QueraError("No session_id and no username/password configured.");
    }
    await this.login();
    this.loggedIn = true;
  }

  async relogin(): Promise<boolean> {
    if (!(this.opts.username && this.opts.password)) return false;
    this.cookies.delete("session_id");
    this.loggedIn = false;
    await this.login();
    this.loggedIn = true;
    return true;
  }

  async login(): Promise<void> {
    if (!(this.opts.username && this.opts.password)) {
      throw new QueraError("No username/password configured — run 'Quera: Sign In'.");
    }
    const page = await this.request("accounts/login", {
      headers: { Accept: "text/html" }, __authFlow: true,
    } as any);
    this.raiseFor(page, "load the Quera sign-in page");
    const html = await page.text().catch(() => "");
    const token = this.csrf() || parseForm(html)?.fields.get("csrfmiddlewaretoken");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: this.base.replace(/\/$/, ""),
      Referer: new URL("accounts/login", this.base).toString(),
    };
    if (token) headers["X-CSRFToken"] = token;

    const start = await this.request(LOGIN_API_PATH, {
      method: "POST", headers, __authFlow: true,
      body: JSON.stringify({
        identifier: this.opts.username,
        password: this.opts.password,
        preferred_process: "password",
      }),
    } as any);
    if (!start.ok) {
      throw new QueraError(`Sign-in failed: ${await describeLoginFailure(start)}`, start.status || 401);
    }
    const nextStep = String((await start.json().catch(() => ({})))?.next_step ?? "password");
    if (nextStep !== "password") {
      throw new QueraError(
        `This account signs in with «${nextStep}», not a password. Sign in at quera.org ` +
          "in a browser and paste the session_id cookie instead — run 'Quera: Sign In' " +
          "and choose the session id option.",
        401
      );
    }

    const verify = await this.request(LOGIN_VERIFY_PATH, {
      method: "POST", headers, __authFlow: true,
      body: JSON.stringify({
        identifier: this.opts.username,
        step: nextStep,
        credential: this.opts.password,
      }),
    } as any);
    if (this.cookies.get("session_id")) {
      this.loggedIn = true;
      return;
    }
    throw new QueraError(
      `Sign-in failed: ${await describeLoginFailure(verify)} If your account uses a ` +
        "one-time code or a Google/GitHub button, sign in at quera.org in a browser " +
        "and paste the session_id cookie instead.",
      verify.status || 401
    );
  }

  private buildIdInFlight?: Promise<string>;

  async getBuildId(refresh = false): Promise<string> {
    if (this.buildId && !refresh) return this.buildId;
    if (!this.buildIdInFlight) {
      this.buildIdInFlight = (async () => {
        const res = await this.request("problemset", { headers: { Accept: "text/html" } });
        this.raiseFor(res, "discover buildId");
        const html = await res.text();
        const m = html.match(/"buildId"\s*:\s*"([^"]+)"/);
        if (!m) throw new QueraError("Could not discover the Next.js buildId.");
        this.buildId = m[1];
        return this.buildId;
      })().finally(() => (this.buildIdInFlight = undefined));
    }
    return this.buildIdInFlight;
  }

  async getNextData(
    path: string,
    query: Record<string, string | string[]> = {},
    pagePath?: string
  ): Promise<any> {
    if (this.authMethod !== "none") await this.ensureLoggedIn();
    for (let attempt = 0; attempt < 2; attempt++) {
      let build: string;
      try {
        build = await this.getBuildId(attempt === 1);
      } catch {
        break;
      }
      const dataPath = `_next/data/${build}/${this.locale}/${path.replace(/^\/|\/$/g, "")}.json`;
      const res = await this.request(dataPath, {
        query,
        headers: { Accept: "application/json", "x-nextjs-data": "1" },
      });
      if (res.status === 404 && attempt === 0) continue;
      if (res.ok) {
        const body = await res.json().catch(() => undefined);
        if (body && body.pageProps) return body.pageProps;
        break;
      }
      if (res.status === 401 || res.status === 403) this.raiseFor(res, `read ${path}`);
      break;
    }
    const html = await this.getHtml(pagePath || path, query);
    const data = extractNextData(html);
    if (!data) throw new QueraError(`No __NEXT_DATA__ on ${path}; may need login or be geo-restricted.`);
    if (!this.buildId && data.buildId) this.buildId = data.buildId;
    return data?.props?.pageProps || {};
  }

  async getHtml(path: string, query: Record<string, string | string[]> = {}): Promise<string> {
    if (this.authMethod !== "none") await this.ensureLoggedIn();
    let res = await this.request(path, { query, headers: { Accept: "text/html" } });
    if (this.isLoginRedirect(res) && (await this.relogin().catch(() => false))) {
      res = await this.request(path, { query, headers: { Accept: "text/html" } });
    }
    if (this.isLoginRedirect(res)) {
      throw new QueraError(
        `Not signed in: Quera redirected GET ${path} to the sign-in page. ` +
          "The session_id is missing or expired — run 'Quera: Sign In' again.",
        401
      );
    }
    this.raiseFor(res, `GET ${path}`);
    return res.text();
  }

  async postAction(path: string, fields: Record<string, string | number>): Promise<any> {
    await this.ensureLoggedIn();
    const token = await this.ensureCsrf("problemset");
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) body.set(k, String(v));
    if (token) body.set("csrfmiddlewaretoken", token);
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json, text/plain, */*",
      Origin: this.base.replace(/\/$/, ""),
      Referer: new URL(path, this.base).toString(),
    };
    if (token) headers["X-CSRFToken"] = token;
    const res = await this.request(path, { method: "POST", headers, body: body.toString() });
    this.raiseFor(res, `POST ${path}`);
    this.raiseForLoginRedirect(res, `POST ${path}`);
    const txt = await res.text();
    try {
      return JSON.parse(txt);
    } catch {
      return { raw: txt };
    }
  }

  async publishLesson(
    chapterId: number,
    lessonId: number,
    overrides: { name?: string; description?: string }
  ): Promise<{ status: number; redirected: boolean }> {
    await this.ensureLoggedIn();
    const path = `college/assignments/${chapterId}/edit_problem/${lessonId}`;
    const html = await this.getHtml(path);
    const form = parseForm(html);
    if (!form || !form.fields.has("description")) {
      throw new QueraError("No editable lesson form found (missing college-admin permission?).");
    }
    const token = this.csrf();
    const fd = new FormData();
    for (const [k, v] of form.fields) fd.set(k, k in overrides ? (overrides as any)[k] ?? v : v);
    if (overrides.name !== undefined) fd.set("name", overrides.name);
    if (overrides.description !== undefined) fd.set("description", overrides.description);
    if (token && !fd.has("csrfmiddlewaretoken")) fd.set("csrfmiddlewaretoken", token);
    for (const f of form.fileFields) fd.set(f, new Blob([]), "");
    const headers: Record<string, string> = { Origin: this.base.replace(/\/$/, ""), Referer: new URL(path, this.base).toString() };
    if (token) headers["X-CSRFToken"] = token;
    const action = form.action ? new URL(form.action, this.base).pathname.replace(/^\//, "") : path;
    const res = await this.request(action, { method: "POST", headers, body: fd });
    this.raiseFor(res, `publish lesson ${lessonId}`);
    this.raiseForLoginRedirect(res, `publish lesson ${lessonId}`);
    return { status: res.status, redirected: res.status >= 300 && res.status < 400 };
  }

  async submitFile(
    assignmentId: number | null,
    problemId: number,
    filename: string,
    content: string | Buffer,
    fileTypeId?: number,
    area: "course" | "contest" | "problemset" = "course"
  ): Promise<{ status: number; redirected: boolean; location: string | null; body?: any }> {
    await this.ensureLoggedIn();
    const problemset = area === "problemset" || assignmentId === null;
    const path = problemset
      ? `problemset/${problemId}/submit`
      : `${area}/assignments/${assignmentId}/problems/${problemId}`;
    const form = new FormData();
    let token: string | undefined;
    if (!problemset) {
      const rendered = parseForm(await this.getHtml(path).catch(() => ""));
      if (rendered) {
        for (const [k, v] of rendered.fields) {
          if (k !== "file" && k !== "file_type") form.set(k, v);
        }
        token = rendered.fields.get("csrfmiddlewaretoken") || undefined;
      }
    }
    token = token || (await this.ensureCsrf(problemset ? `problemset/${problemId}` : path));
    if (fileTypeId !== undefined) form.set("file_type", String(fileTypeId));
    if (token) form.set("csrfmiddlewaretoken", token);
    const payload = typeof content === "string" ? content : new Uint8Array(content);
    form.set("file", new Blob([payload as BlobPart], { type: "text/plain" }), filename);
    const headers: Record<string, string> = {
      Origin: this.base.replace(/\/$/, ""),
      Referer: new URL(problemset ? `problemset/${problemId}` : path, this.base).toString(),
    };
    if (token) headers["X-CSRFToken"] = token;
    const res = await this.request(path, { method: "POST", headers, body: form });
    this.raiseFor(res, `submit to ${path}`);
    this.raiseForLoginRedirect(res, `submit to ${path}`);
    let body: any;
    if ((res.headers.get("Content-Type") || "").includes("json")) {
      body = await res.json().catch(() => undefined);
    }
    return {
      status: res.status,
      redirected: res.status >= 300 && res.status < 400,
      location: res.headers.get("Location"),
      body,
    };
  }

  async download(path: string): Promise<DownloadResult> {
    if (this.authMethod !== "none") await this.ensureLoggedIn();
    const res = await this.request(path, { headers: { Accept: "*/*" } });
    this.raiseFor(res, `download ${path}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const disposition = res.headers.get("Content-Disposition") || "";
    const fnMatch = disposition.match(/filename="?([^";]+)"?/);
    return {
      filename: fnMatch?.[1] || path.replace(/\/$/, "").split("/").pop() || "download.bin",
      contentType: res.headers.get("Content-Type") || "application/octet-stream",
      bytes: buf,
    };
  }

  async listProblems(query: Record<string, string | string[]>, page: number): Promise<ProblemPage> {
    const props = await this.getNextData("problemset", { ...query, page: String(page) });
    const conn = flattenConnection(props.problems || {});
    const items = (conn.items || []).map((p: any) => normalizeProblem(p));
    return {
      total: conn.total,
      count: items.length,
      page,
      items,
      filterChoices: props.problems?.filterChoices,
    };
  }

  async getProblem(pk: number, tab?: string): Promise<ProblemDetail> {
    const query: Record<string, string> = { pk: String(pk) };
    if (tab) query.tab = tab;
    const props = await this.getNextData(`problemset/${pk}`, query, `problemset/${pk}`);
    const problem: ProblemDetail = props.problem || props;
    if (problem.submissions) problem.submissions = flattenConnection(problem.submissions);
    return normalizeProblem(problem);
  }

  async getCourse(id: number): Promise<Course> {
    const props = await this.getNextData(`course/${id}`, { id: String(id) }, `course/${id}`);
    const course = props.course || props;
    if (Array.isArray(course?.assignments)) {
      for (const a of course.assignments) if (a && "pk" in a) a.pk = asId(a.pk);
    }
    if (course && "id" in course) course.id = asId(course.id);
    return course;
  }

  async getContests(): Promise<{ active: any[]; finished: any[]; categories: any[] }> {
    const props = await this.getNextData("contest", {}, "contest");
    const take = (k: string) => (Array.isArray(props[k]) ? props[k] : []);
    return {
      active: [...take("activeFeaturedContests"), ...take("activeOtherContests"), ...take("activePrivateContests")],
      finished: take("finishedContests"),
      categories: take("categories"),
    };
  }

  async getClasses(): Promise<{
    total?: number;
    items: { id: number; name: string; instructor?: string; term?: string }[];
    deadlines: any[];
  }> {
    const props = await this.getNextData("course", {}, "course");
    const root = props.course || props;
    const conn = flattenConnection(root.courses || {});
    const asName = (v: any): string | undefined =>
      typeof v === "string" ? v : v && typeof v === "object" ? v.name || v.full_name || v.username : undefined;
    const items = (conn.items || []).map((c: any) => ({
      id: asId(c.id ?? c.pk),
      name: c.name || `Class ${c.id ?? c.pk}`,
      instructor: asName(c.instructor) || asName(c.instructor_name),
      term: asName(c.qa?.term) || asName(c.term),
    }));
    return { total: conn.total, items, deadlines: root.course_deadline_widget_data || [] };
  }

  async getDashboard(): Promise<{ user?: any; colleges: any[]; notifications: any[]; data: any }> {
    const html = await this.getHtml("dashboard");
    const qnavMatch = html.match(
      /<script id="__qnav_data__" type="application\/json">([\s\S]*?)<\/script>/
    );
    const dashMatch = html.match(/<div id="__dashboard_data__"[^>]*>([\s\S]*?)<\/div>/);
    let qnav: any = {};
    let data: any = {};
    try {
      if (qnavMatch) qnav = JSON.parse(qnavMatch[1]);
    } catch { /* tolerate */ }
    try {
      if (dashMatch) data = JSON.parse(decodeHtmlEntities(dashMatch[1]));
    } catch { /* tolerate */ }
    return {
      user: qnav.user,
      colleges: qnav.colleges || [],
      notifications: qnav.notifications?.items || [],
      data,
    };
  }

  async listAssignmentItems(assignmentId: number, area: "course" | "contest" = "course"): Promise<AssignmentItem[]> {
    return (await this.listAssignmentContents(assignmentId, area)).items;
  }

  async listAssignmentContents(
    assignmentId: number,
    area: "course" | "contest" = "course"
  ): Promise<{ items: AssignmentItem[]; emptyReason?: string }> {
    const html = await this.getHtml(`${area}/assignments/${assignmentId}/problems`);
    const items = parseProblemLinks(html);
    if (items.length) return { items };
    const text = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    const known = [
      "هنوز مسئله‌ای وجود ندارد",
      "هنوز سوالی اضافه نشده",
      "مسابقه هنوز شروع نشده",
      "شما در این مسابقه ثبت‌نام نکرده",
      "دسترسی ندارید",
    ];
    return { items, emptyReason: known.find((phrase) => text.includes(phrase)) };
  }

  async getAssignmentProblemsMarkdown(assignmentId: number, area: "course" | "contest" = "course"): Promise<string> {
    const items = await this.listAssignmentItems(assignmentId, area);
    const rows = items.map((p) =>
      `- **${p.name}**${p.score !== undefined ? ` · ${p.score} pts` : ""} — _${p.kind === "problem" ? "problem" : "lesson"}_ (#${p.id}) — \`/${area}/assignments/${assignmentId}/problems/${p.id}\``);
    return `# ${area === "contest" ? "Contest" : "Assignment"} ${assignmentId} — problems\n\n${
      rows.length ? rows.join("\n") : "_No problems found (or you lack access)._"}`;
  }

  async getAssignmentProblem(
    assignmentId: number,
    problemId: number,
    area: "course" | "contest" = "course"
  ): Promise<ProblemDetail> {
    const html = await this.getHtml(`${area}/assignments/${assignmentId}/problems/${problemId}`);
    const next = extractNextData(html);
    const nextProblem = next?.props?.pageProps?.problem;
    if (nextProblem) {
      const p: ProblemDetail = normalizeProblem(nextProblem);
      if (!p.assignment?.pk) p.assignment = { pk: assignmentId };
      p.area = area;
      return p;
    }
    const page = parseLmsProblemPage(html, problemId);
    const sibling = page.siblings.find((s) => s.id === problemId);
    return {
      pk: problemId,
      name: page.name || sibling?.name || `Problem ${problemId}`,
      description: page.description ?? "_No readable statement on that page (you may lack access)._",
      score: sibling?.score,
      assignment: { pk: assignmentId },
      allowed_file_types: page.fileTypes?.map((f) => ({ id: f.id, label: f.label })),
      area,
      can_submit: page.canSubmit,
      submit_note: page.submitNote,
    };
  }

  async getCourseProblemMarkdown(
    assignmentId: number,
    problemId: number,
    area: "course" | "contest" = "course"
  ): Promise<string> {
    const html = await this.getHtml(`${area}/assignments/${assignmentId}/problems/${problemId}`);
    const page = parseLmsProblemPage(html, problemId);
    if (page.description !== undefined) {
      const head = page.name ? `# ${page.name}\n\n` : "";
      return `${head}${page.description}`;
    }
    const scoped = extractDivById(html, "a-container") ?? extractDivById(html, "body_container");
    const md = htmlToMarkdownLite(scoped ?? html);
    return md || "_No readable content on that page (you may lack access)._";
  }

  async getScoreboardMarkdown(assignmentId: number, area: "contest" | "course" = "contest"): Promise<string> {
    const html = await this.getHtml(`${area}/assignments/${assignmentId}/scoreboard`);
    const rows = parseHtmlTable(html);
    const title = `# Standings — ${area} assignment ${assignmentId}`;
    if (!rows.length) return `${title}\n\n_No scoreboard table found (or you lack access)._`;
    const [head, ...body] = rows;
    const md = [
      `| ${head.join(" | ")} |`,
      `| ${head.map(() => "---").join(" | ")} |`,
      ...body.map((r) => `| ${r.join(" | ")} |`),
    ].join("\n");
    return `${title}\n\n${md}`;
  }

  async addAssignmentProblem(
    assignmentId: number,
    opts: {
      area?: "course" | "college" | "contest";
      name: string;
      description?: string;
      score?: number;
      type?: "J" | "C" | "U" | "F";
      timeLimitMs?: number;
      memoryLimitMb?: number;
      allowedFileTypeIds?: number[];
      testsZip?: { filename: string; bytes: Buffer };
      initialProjectZip?: { filename: string; bytes: Buffer };
    }
  ): Promise<{ status: number; redirected: boolean; location: string | null }> {
    await this.ensureLoggedIn();
    const area = opts.area || "course";
    const path = `${area}/assignments/${assignmentId}/add_problem`;
    const html = await this.getHtml(path);
    const form = parseForm(html);
    if (!form) throw new QueraError(`No add_problem form on ${path} — you may lack staff permission.`);
    const token = this.cookies.get("csrftoken") || form.fields.get("csrfmiddlewaretoken") || (await this.ensureCsrf(path));
    const fd = new FormData();
    for (const [k, v] of form.fields) fd.set(k, v);
    if (token) fd.set("csrfmiddlewaretoken", token);
    fd.set("name", opts.name);
    if (opts.description !== undefined) fd.set("description", opts.description);
    if (opts.score !== undefined) fd.set("score", String(opts.score));
    if (opts.type) fd.set("type", opts.type);
    if (opts.timeLimitMs !== undefined) fd.set("base_time_limit", String(opts.timeLimitMs));
    if (opts.memoryLimitMb !== undefined) fd.set("base_memory_limit", String(opts.memoryLimitMb));
    for (const id of opts.allowedFileTypeIds || []) {
      fd.set(`j_allow_${id}`, "on");
      if (opts.timeLimitMs !== undefined) fd.set(`j_tl_${id}`, String(opts.timeLimitMs));
      if (opts.memoryLimitMb !== undefined) fd.set(`j_ml_${id}`, String(opts.memoryLimitMb));
    }
    if (opts.testsZip) {
      fd.set("tests", new Blob([new Uint8Array(opts.testsZip.bytes) as BlobPart],
        { type: "application/zip" }), opts.testsZip.filename);
    }
    if (opts.initialProjectZip) {
      fd.set("initial_project", new Blob([new Uint8Array(opts.initialProjectZip.bytes) as BlobPart],
        { type: "application/zip" }), opts.initialProjectZip.filename);
    }
    fd.set("save_and_continue_editing", "ذخیره و ادامه ویرایش");
    const headers: Record<string, string> = {
      Origin: this.base.replace(/\/$/, ""),
      Referer: new URL(path, this.base).toString(),
    };
    if (token) headers["X-CSRFToken"] = token;
    const res = await this.request(path, { method: "POST", headers, body: fd });
    this.raiseFor(res, `add problem to ${path}`);
    this.raiseForLoginRedirect(res, `add problem to ${path}`);
    return {
      status: res.status,
      redirected: res.status >= 300 && res.status < 400,
      location: res.headers.get("Location"),
    };
  }

  async updateAssignmentProblem(
    assignmentId: number,
    problemId: number,
    opts: {
      area?: "course" | "college" | "contest";
      name?: string;
      description?: string;
      score?: number;
      allowedFileTypeIds?: number[];
    }
  ): Promise<{ status: number; redirected: boolean; location: string | null }> {
    await this.ensureLoggedIn();
    const area = opts.area || "course";
    const path = `${area}/assignments/${assignmentId}/edit_problem/${problemId}`;
    const html = await this.getHtml(path);
    const form = parseForm(html);
    if (!form) throw new QueraError(`No edit_problem form on ${path} — you may lack staff permission.`);
    const token = this.cookies.get("csrftoken") || form.fields.get("csrfmiddlewaretoken") || (await this.ensureCsrf(path));
    const fd = new FormData();
    for (const [k, v] of form.fields) fd.set(k, v);
    if (token) fd.set("csrfmiddlewaretoken", token);
    if (opts.name !== undefined) fd.set("name", opts.name);
    if (opts.description !== undefined) fd.set("description", opts.description);
    if (opts.score !== undefined) fd.set("score", String(opts.score));
    for (const id of opts.allowedFileTypeIds || []) fd.set(`j_allow_${id}`, "on");
    for (const f of form.fileFields) fd.set(f, new Blob([]), "");
    fd.set("save_and_continue_editing", "ذخیره و ادامه ویرایش");
    const headers: Record<string, string> = {
      Origin: this.base.replace(/\/$/, ""),
      Referer: new URL(path, this.base).toString(),
    };
    if (token) headers["X-CSRFToken"] = token;
    const res = await this.request(path, { method: "POST", headers, body: fd });
    this.raiseFor(res, `edit problem ${problemId}`);
    this.raiseForLoginRedirect(res, `edit problem ${problemId}`);
    return { status: res.status, redirected: res.status >= 300 && res.status < 400,
             location: res.headers.get("Location") };
  }

  async deleteAssignmentProblem(problemId: number): Promise<any> {
    return this.postAction("assignment/delete_problem", { problem_id: problemId });
  }

  async reorderAssignmentProblems(
    assignmentId: number,
    orderedIds: number[]
  ): Promise<any> {
    const fields: Record<string, string | number> = {};
    orderedIds.forEach((id, index) => { fields[String(id)] = index; });
    return this.postAction(`assignment/${assignmentId}/reorder_problems`, fields);
  }

  async getAssignmentSubmissions(
    assignmentId: number,
    area: "course" | "contest" = "course",
    problemId?: number
  ): Promise<{ pk: number; problem_id?: number; problem_name?: string; submit_time?: string;
    file_type?: string; judge_score?: number; is_final?: boolean }[]> {
    let html = "";
    for (const tail of ["submissions", "submissions/all"]) {
      try {
        html = await this.getHtml(`${area}/assignments/${assignmentId}/${tail}`);
        if (html.includes("data-submission_id")) break;
      } catch { /* try the next view */ }
    }
    return parseSubmissionsTable(html).filter((s) => !problemId || s.problem_id === problemId);
  }

  async getCollegeChapters(collegeId: number, slug?: string): Promise<{
    name?: string;
    startingChapterId?: number;
    chapters: { id: number; name: string; passedPercent?: number; items: {
      id: number; name: string; kind: "lesson" | "problem"; score?: number;
      gainedScore?: number; answered?: boolean; completed?: boolean }[] }[];
  }> {
    const resolved = slug || (await this.resolveCollegeSlug(collegeId));
    const path = `college/landpage/${collegeId}${resolved ? `/${resolved}` : ""}`;
    const props = await this.getNextData(path, {}, path);
    const college = props.college || props;
    const assignments = college?.landpage?.contents?.assignments || college?.editor?.assignments || [];
    return {
      name: college?.name,
      startingChapterId: college?.starting_assignment?.id,
      chapters: assignments.map((a: any) => ({
        id: a.id,
        name: a.name,
        passedPercent: a.passed_percent,
        items: (a.problems || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          kind: p.training_type === "LSN" ? "lesson" : "problem",
          score: p.problem_score,
          gainedScore: p.gained_score,
          answered: p.answered,
          completed: p.is_completed,
        })),
      })),
    };
  }

  private collegeSlugs?: Map<number, string>;

  private async resolveCollegeSlug(collegeId: number): Promise<string | undefined> {
    if (!this.collegeSlugs) {
      this.collegeSlugs = new Map();
      try {
        const user = await this.whoami();
        for (const c of user?.my_colleges || []) {
          const m = String(c.url || "").match(/college\/(?:land\/college\/|landpage\/)?(\d+)\/([^/?#]+)/);
          if (m) this.collegeSlugs.set(Number(m[1]), m[2]);
        }
      } catch {
      }
    }
    return this.collegeSlugs.get(collegeId);
  }

  async getCollegeLesson(collegeId: number, chapterId: number, lessonId: number): Promise<{
    current?: any;
    chapters?: any[];
    collegeName?: string;
  }> {
    const path = `college/${collegeId}/chapter/${chapterId}/lesson/${lessonId}`;
    const props = await this.getNextData(path, {}, path);
    const college = props.college || props;
    return {
      current: college?.editor?.current_problem,
      chapters: college?.editor?.assignments,
      collegeName: college?.name,
    };
  }

  async getLessonBody(chapterId: number, lessonId: number): Promise<string | undefined> {
    const path = `college/assignments/${chapterId}/edit_problem/${lessonId}`;
    const html = await this.getHtml(path);
    const ta = html.match(/<textarea[^>]*name="description"[^>]*>([\s\S]*?)<\/textarea>/i);
    if (ta) return decodeHtmlEntities(ta[1]);
    const inp = html.match(/<input[^>]*name="description"[^>]*value="([^"]*)"/i);
    return inp ? decodeHtmlEntities(inp[1]) : undefined;
  }

  async whoami(): Promise<any> {
    const html = await this.getHtml("problemset");
    const data = extractNextData(html);
    if (!data) {
      throw new QueraError(
        "Could not read Quera's page data — the problemset page returned no " +
          "__NEXT_DATA__. Quera may be rate-limiting, geo-blocking, or serving " +
          "a maintenance page.",
        502
      );
    }
    const props = data.props || {};
    for (const c of [props, props.pageProps]) {
      if (c?.globalServerValues?.currentUser) return c.globalServerValues.currentUser;
    }
    const found = findKeyDeep(data, "currentUser");
    if (found) return found;
    return { is_authenticated: false };
  }
}

function findKeyDeep(root: any, key: string, maxDepth = 8): any {
  const queue: Array<{ node: any; depth: number }> = [{ node: root, depth: 0 }];
  while (queue.length) {
    const { node, depth } = queue.shift()!;
    if (!node || typeof node !== "object" || depth > maxDepth) continue;
    const hit = (node as any)[key];
    if (hit && typeof hit === "object") return hit;
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") queue.push({ node: value, depth: depth + 1 });
    }
  }
  return undefined;
}
