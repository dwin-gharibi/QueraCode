export const LOCALES = ["fa", "en", "ar"] as const;
export const DEFAULT_LOCALE = "fa";

export interface Verdict {
  code: string;
  en: string;
  fa: string;
  accepted: boolean;
}

export const VERDICTS: Verdict[] = [
  { code: "NJ", en: "Not judged", fa: "داوری‌نشده", accepted: false },
  { code: "AC", en: "Accepted", fa: "پذیرفته‌شده", accepted: true },
  { code: "WA", en: "Wrong answer", fa: "پاسخ نادرست", accepted: false },
  { code: "TLE", en: "Time limit exceeded", fa: "محدودیت زمان", accepted: false },
  { code: "MLE", en: "Memory limit exceeded", fa: "محدودیت حافظه", accepted: false },
  { code: "OLE", en: "Output limit exceeded", fa: "محدودیت خروجی", accepted: false },
  { code: "RE", en: "Runtime error", fa: "خطای اجرا", accepted: false },
  { code: "CE", en: "Compile error", fa: "خطای کامپایل", accepted: false },
  { code: "SE", en: "Syntax error", fa: "خطای نحوی", accepted: false },
  { code: "C", en: "Compiled", fa: "کامپایل‌شده", accepted: false },
  { code: "JE", en: "Judge error", fa: "خطای داور", accepted: false },
  { code: "S", en: "Scored (partial)", fa: "امتیاز جزئی", accepted: false },
];

export function verdictOf(code: string): Verdict | undefined {
  return VERDICTS.find((v) => v.code === (code || "").toUpperCase());
}

export interface SubmissionRow {
  short_judge_result?: string;
  judge_score?: number;
  calculated_judge_score?: number;
  state?: string;
}

export function normalizedScore(row: SubmissionRow): number | undefined {
  if (typeof row.calculated_judge_score === "number") return row.calculated_judge_score;
  if (typeof row.judge_score !== "number") return undefined;
  return row.judge_score > 100 ? row.judge_score / 1000 : row.judge_score;
}

export interface SubmissionOutcome {
  en: string;
  fa: string;
  accepted: boolean;
  partial: boolean;
  pending: boolean;
  score?: number;
}

export function outcomeOf(row: SubmissionRow): SubmissionOutcome {
  const score = normalizedScore(row);
  const code = (row.short_judge_result || "").toUpperCase();

  if (code && code !== "S") {
    const v = verdictOf(code);
    if (v) return { en: v.en, fa: v.fa, accepted: v.accepted, partial: false, pending: false, score };
  }
  if (score === undefined) {
    return { en: "Waiting for the judge", fa: "در انتظار داوری", accepted: false, partial: false, pending: true };
  }
  if (score >= 100) return { en: "Accepted", fa: "پذیرفته‌شده", accepted: true, partial: false, pending: false, score };
  if (score <= 0) return { en: "Rejected", fa: "رد شده", accepted: false, partial: false, pending: false, score };
  return { en: "Partial score", fa: "امتیاز جزئی", accepted: false, partial: true, pending: false, score };
}

export const DIFFICULTIES = [
  { code: "UNKNOWN", filter: "UNK", en: "Unknown", fa: "نامشخص" },
  { code: "EASY", filter: "EZ", en: "Easy", fa: "ساده" },
  { code: "MEDIUM", filter: "MED", en: "Medium", fa: "متوسط" },
  { code: "HARD", filter: "HARD", en: "Hard", fa: "سخت" },
];

export const ORDERINGS = [
  "new", "old", "most-solutions", "least-solutions", "most-liked", "relevant", "random",
];

export const SOLVED_STATES = ["full", "partial", "no-try"];
export const CATEGORIES = ["technology", "contest", "university", "olympiad"];
export const PROBLEM_TYPES = [
  { code: "J", en: "Judged", fa: "داوری‌شونده" },
  { code: "C", en: "Compile-only", fa: "فقط کامپایل" },
  { code: "U", en: "Upload-only", fa: "فقط بارگذاری" },
  { code: "PJ", en: "Project judge", fa: "داوری پروژه" },
  { code: "F", en: "Form", fa: "فرم" },
];

export const TAGS: Record<number, string> = {
  72: "Android", 116: "#C", 118: "C", 108: "DevOps", 77: "Django", 80: "Front-end",
  111: "Git", 109: "Golang", 73: "Java", 91: "Laravel", 92: "Linux", 90: "PHP",
  78: "Python", 98: "React", 110: "Spring", 22: "برنامه‌نویسی پیشرفته", 93: "پایگاه داده",
  74: "پردازش تصویر", 107: "دانش‌آموزی", 23: "طراحی الگوریتم", 1: "مبانی برنامه‌نویسی",
  65: "هوش مصنوعی و سیستم‌های خبره", 76: "یادگیری ماشین", 119: "LLM", 120: "پردازش داده",
  106: "تحلیل داده", 66: "دانشگاه امیرکبیر", 105: "دانشگاه اهواز", 104: "دانشگاه تهران",
  64: "دانشگاه شریف", 67: "دانشگاه فردوسی", 30: "هوش مصنوعی", 82: "برنامه‌نویسی پویا",
  114: "بهینه‌سازی", 75: "پازل", 88: "پیاده‌سازی", 112: "ترکیبیات", 95: "تقسیم و حل",
  84: "جست‌وجو", 86: "حریصانه", 89: "خلاقانه", 21: "داده ساختار", 96: "درخت", 81: "رشته‌ها",
  85: "ریاضیات", 83: "گراف", 115: "معمایی", 113: "نظریه اعداد", 87: "هندسه", 63: "دوره ۲۰",
  18: "دوره ۲۴", 19: "دوره ۲۵", 29: "دوره ۲۶", 79: "دوره ۲۷", 97: "دوره ۲۸", 99: "دوره ۲۹",
  70: "مقدماتی", 117: "Back-end",
};

export function resolveTag(value: string | number): number | undefined {
  if (typeof value === "number") return TAGS[value] ? value : undefined;
  const t = String(value).trim();
  if (/^\d+$/.test(t)) return TAGS[Number(t)] ? Number(t) : undefined;
  const found = Object.entries(TAGS).find(([, name]) => name.toLowerCase() === t.toLowerCase());
  return found ? Number(found[0]) : undefined;
}

export interface LangInfo {
  key: string;
  label: string;
  ext: string;
  comment: string;
}

export const LANGUAGES: LangInfo[] = [
  { key: "python", label: "Python 3", ext: ".py", comment: "#" },
  { key: "cpp", label: "C++", ext: ".cpp", comment: "//" },
  { key: "c", label: "C", ext: ".c", comment: "//" },
  { key: "csharp", label: "C#", ext: ".cs", comment: "//" },
  { key: "java", label: "Java", ext: ".java", comment: "//" },
  { key: "go", label: "Go", ext: ".go", comment: "//" },
  { key: "javascript", label: "JavaScript (Node.js)", ext: ".js", comment: "//" },
  { key: "typescript", label: "TypeScript", ext: ".ts", comment: "//" },
  { key: "php", label: "PHP", ext: ".php", comment: "//" },
  { key: "ruby", label: "Ruby", ext: ".rb", comment: "#" },
  { key: "rust", label: "Rust", ext: ".rs", comment: "//" },
  { key: "kotlin", label: "Kotlin", ext: ".kt", comment: "//" },
  { key: "swift", label: "Swift", ext: ".swift", comment: "//" },
  { key: "scala", label: "Scala", ext: ".scala", comment: "//" },
  { key: "dart", label: "Dart", ext: ".dart", comment: "//" },
  { key: "haskell", label: "Haskell", ext: ".hs", comment: "--" },
  { key: "perl", label: "Perl", ext: ".pl", comment: "#" },
  { key: "bash", label: "Bash", ext: ".sh", comment: "#" },
  { key: "sql", label: "SQL", ext: ".sql", comment: "--" },
  { key: "django", label: "Django (Python)", ext: ".py", comment: "#" },
  { key: "laravel", label: "Laravel (PHP)", ext: ".php", comment: "//" },
  { key: "react", label: "React (JSX/TSX)", ext: ".tsx", comment: "//" },
  { key: "dockerfile", label: "Dockerfile", ext: ".dockerfile", comment: "#" },
  { key: "kubernetes", label: "Kubernetes (YAML)", ext: ".yaml", comment: "#" },
  { key: "terraform", label: "Terraform (HCL)", ext: ".tf", comment: "#" },
  { key: "zip", label: "Zip project", ext: ".zip", comment: "#" },
];

export function langByKey(key: string): LangInfo | undefined {
  return LANGUAGES.find((l) => l.key === key.toLowerCase());
}

export const FILE_TYPES: Record<string, Record<number, { label: string; lang: string }>> = {
  J: {
    1: { label: "C", lang: "c" }, 2: { label: "C++", lang: "cpp" }, 3: { label: "Java 8", lang: "java" },
    5: { label: "Python 3.12", lang: "python" }, 36: { label: "Mono C#", lang: "csharp" },
    37: { label: "PHP 7", lang: "php" }, 38: { label: "Node.js", lang: "javascript" },
    39: { label: "Perl", lang: "perl" }, 40: { label: "Go", lang: "go" }, 41: { label: "Ruby", lang: "ruby" },
    48: { label: "Objective-C", lang: "objectivec" }, 49: { label: "Swift", lang: "swift" },
    52: { label: "JavaScript", lang: "javascript" }, 53: { label: "Haskell", lang: "haskell" },
    59: { label: "PyPy 3", lang: "python" }, 65: { label: "PHP 8", lang: "php" },
    66: { label: "Rust", lang: "rust" }, 67: { label: "Java 17", lang: "java" },
    69: { label: "TypeScript", lang: "typescript" }, 70: { label: "Kotlin", lang: "kotlin" },
    71: { label: "C#", lang: "csharp" }, 72: { label: "F#", lang: "fsharp" },
  },
  C: { 14: { label: "C", lang: "c" }, 15: { label: "C++", lang: "cpp" }, 16: { label: "Java 8", lang: "java" }, 18: { label: "Python 3.12", lang: "python" } },
  U: {
    7: { label: "Zip", lang: "zip" }, 35: { label: "tar.gz", lang: "zip" }, 68: { label: "Text", lang: "markdown" },
    8: { label: "PDF", lang: "pdf" }, 9: { label: "C", lang: "c" }, 10: { label: "C++", lang: "cpp" },
    11: { label: "Java 8", lang: "java" }, 13: { label: "Python 3", lang: "python" }, 30: { label: "C#", lang: "csharp" },
    31: { label: "JavaScript", lang: "javascript" },
  },
  PJ: {
    42: { label: "Django", lang: "django" }, 43: { label: "FrontEnd", lang: "react" }, 44: { label: "Linux", lang: "bash" },
    45: { label: "PHP", lang: "php" }, 46: { label: "Python", lang: "python" }, 47: { label: "SQL", lang: "sql" },
    50: { label: "Laravel", lang: "laravel" }, 62: { label: "Golang", lang: "go" }, 64: { label: "Devops", lang: "dockerfile" },
    73: { label: "Dotnet", lang: "csharp" }, 74: { label: "LLM", lang: "python" },
  },
};

export function resolveFileTypeId(problemType: string, language: string): number | undefined {
  const table = FILE_TYPES[(problemType || "J").toUpperCase()];
  if (!table) return undefined;
  const q = language.toLowerCase();
  const hit = Object.entries(table).find(
    ([, info]) => info.lang === q || info.label.toLowerCase() === q
  );
  return hit ? Number(hit[0]) : undefined;
}

export const MACROS = [
  "%problem.initial_project%",
  "%problem.limits%",
  "%problem.test_1%",
  "%problem.test_input_1%",
  "%problem.test_output_1%",
  "%problem.qbox_download%",
  "%video.aparat_HASH%",
  "%align_right_start%",
  "%align_end%",
];
