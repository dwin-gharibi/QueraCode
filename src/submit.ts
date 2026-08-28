import * as path from "path";
import { LANGUAGES } from "./constants";


export function submitTarget(problem: { assignment?: { pk?: number } | null; area?: "course" | "contest" }):
  { aid: number | null; area: "course" | "contest" | "problemset" } {
  if (problem.area === "course" || problem.area === "contest") {
    return { aid: problem.assignment?.pk ?? null, area: problem.area };
  }
  return { aid: null, area: "problemset" };
}


export function explainError(e: any, action: string): string {
  const raw = String(e?.message || e || "unknown error");
  const status = Number(e?.status) || Number(raw.match(/HTTP (\d{3})/)?.[1]) || 0;
  const detail = ` (${raw})`;
  if (/AI provider|OPENROUTER|no api key/i.test(raw)) {
    if (/no api key/i.test(raw)) {
      return `${action} needs an AI provider key — run 'Quera AI: Configure AI Provider', ` +
             `or set the provider's API key in the environment.${detail}`;
    }
    return `${action} failed at the AI provider (not Quera): check the key, the model name, ` +
           `and whether the provider is reachable from your network.${detail}`;
  }
  switch (status) {
    case 400:
      return `${action} was rejected as malformed — usually a missing language/file type ` +
             `or a field Quera now requires.${detail}`;
    case 401:
      return `${action} failed: you are not signed in. Run 'Quera: Sign In' to refresh the session.${detail}`;
    case 403:
      return `${action} was refused: the session lacks permission here, or its deadline has passed.${detail}`;
    case 404:
      return `${action} failed: not found. The id may not exist, may be deleted, or may live in a ` +
             `course/contest you cannot access.${detail}`;
    case 409:
      return `${action} is not currently possible.${detail}`;
    case 429:
      return `Quera is rate-limiting you («به کجا چنین شتابان»). Wait a minute, then retry ${action}.${detail}`;
    default:
      if (status >= 500) {
        return `Quera had a server error during ${action} — the target may have been deleted or ` +
               `rejudged. Retry shortly.${detail}`;
      }
      return `${action} failed: ${raw}`;
  }
}

export interface SubmitPlan {
  aid: number | null;
  area: "course" | "contest" | "problemset";
  name: string;
  fileTypeId?: number;
  allowed?: { id: number; label: string; extension?: string }[];
}

export function languageForFile(fsPath: string, fallback: string): string {
  const ext = path.extname(fsPath).toLowerCase();
  return LANGUAGES.find((l) => l.ext === ext)?.key || fallback;
}

export function allowedLanguagesLabel(
  allowed?: { label: string; extension?: string }[]
): string {
  if (!allowed?.length) return "none advertised by the problem";
  return allowed.map((a) => `${a.label}${a.extension ? ` (${a.extension})` : ""}`).join(", ");
}

export interface JudgeTest {
  index: number;
  name: string;
  status: string;
  accepted: boolean;
}

export interface JudgeResult {
  compile?: string;
  note?: string;
  tests: JudgeTest[];
  passed: number;
  total: number;
  verdict: string;
  accepted: boolean;
}

export function verdictForStatus(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("accept")) return "AC";
  if (s.includes("time limit")) return "TLE";
  if (s.includes("memory limit")) return "MLE";
  if (s.includes("output limit")) return "OLE";
  if (s.includes("wrong")) return "WA";
  if (s.includes("compil") && s.includes("error")) return "CE";
  if (s.includes("signal") || s.includes("runtime")) return "RE";
  return "NJ";
}

export function parseJudgeResult(raw: unknown): JudgeResult {
  const html = typeof raw === "string" ? raw : "";
  const spans = [...html.matchAll(/<span class="(shj_[a-z]+)">([\s\S]*?)<\/span>/g)]
    .map((m) => ({ cls: m[1], text: m[2].replace(/<[^>]+>/g, "").trim() }));

  let compile: string | undefined;
  const tests: JudgeTest[] = [];
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (span.cls === "shj_b" && /test/i.test(span.text)) {
      const next = spans[i + 1];
      if (next) {
        tests.push({
          index: tests.length + 1,
          name: span.text,
          status: next.text,
          accepted: next.cls === "shj_g" || /accept/i.test(next.text),
        });
        i++;
      }
      continue;
    }
    if (compile === undefined && /compil/i.test(span.text)) compile = span.text;
  }

  const passed = tests.filter((t) => t.accepted).length;
  const failed = tests.find((t) => !t.accepted);
  const compileFailed = !!compile && /error|fail/i.test(compile);
  const note = tests.length
    ? undefined
    : html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || undefined;
  return {
    compile,
    note,
    tests,
    passed,
    total: tests.length,
    verdict: compileFailed ? "CE"
      : failed ? verdictForStatus(failed.status)
      : tests.length ? "AC" : "NJ",
    accepted: !compileFailed && tests.length > 0 && passed === tests.length,
  };
}
