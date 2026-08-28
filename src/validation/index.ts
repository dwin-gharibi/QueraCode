export interface Finding {
  rule: string;
  line: number;
  severity: "error" | "warning";
  message: string;
}

const PERSIAN = /[؀-ۿ]/;
const RAW_DIAGRAM = /^```\s*(mermaid|d2|dot|graphviz|plantuml)\b/i;
const FORBIDDEN_HEADINGS = [
  "# داستان", "# نحوهٔ ارسال", "# نحوه ارسال",
  "## جمع‌بندی", "## جمع بندی", "## پل به درسنامهٔ بعد", "## اشاره به مطالب بعدی",
];

export function lintMarkdown(md: string): Finding[] {
  const findings: Finding[] = [];
  const lines = md.split("\n");
  let inCode = false;
  lines.forEach((line, i) => {
    const n = i + 1;
    const stripped = line.trim();
    if (stripped.startsWith("```")) {
      if (!inCode) {
        inCode = true;
        const lang = stripped.slice(3).split(" ")[0].trim();
        if (RAW_DIAGRAM.test(stripped))
          findings.push({ rule: "raw-diagram-fence", line: n, severity: "error", message: `Raw '${lang}' fence: render diagrams to an image file.` });
        else if (!lang)
          findings.push({ rule: "fence-missing-language", line: n, severity: "warning", message: "Fenced code block has no language token." });
      } else inCode = false;
      return;
    }
    const hasPersian = PERSIAN.test(line);
    const opens = (line.match(/<mark/g) || []).length;
    const closes = (line.match(/<\/mark>/g) || []).length;
    if (opens && !inCode) findings.push({ rule: "mark-outside-code", line: n, severity: "error", message: "<mark> is only styled inside code blocks." });
    if (opens !== closes) findings.push({ rule: "mark-unbalanced", line: n, severity: "error", message: "Every <mark> needs a matching </mark> on the same line." });
    if (!inCode) {
      if (line.includes("—")) findings.push({ rule: "em-dash", line: n, severity: "error", message: "Em-dash (—) is forbidden in Persian content." });
      if (hasPersian && (line.includes('"') || line.includes("'"))) findings.push({ rule: "ascii-quotes", line: n, severity: "warning", message: "Use Persian guillemets «...» in Persian prose." });
      if (/[يىك]/.test(line)) findings.push({ rule: "arabic-letters", line: n, severity: "warning", message: "Arabic «ي/ى/ك» found; use Persian «ی/ک»." });
      if (stripped.startsWith("#")) {
        for (const bad of FORBIDDEN_HEADINGS) {
          if (stripped.replace(/\s/g, "").startsWith(bad.replace(/\s/g, ""))) {
            findings.push({ rule: "forbidden-heading", line: n, severity: "error", message: `Forbidden heading «${bad}».` });
            break;
          }
        }
      }
    }
  });
  if (inCode) findings.push({ rule: "unclosed-fence", line: lines.length, severity: "error", message: "Unclosed code fence (```)." });
  return findings;
}

export function normalizePersian(text: string, persianDigits = false): { text: string; changed: boolean } {
  const original = text;
  let out = text.replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/ة/g, "ه");
  out = out.replace(/(^|\s)(ن?می) (?=[؀-ۿ])/g, `$1$2‌`);
  out = out.replace(/[ \t]{2,}/g, " ");
  if (persianDigits) out = out.replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  return { text: out, changed: out !== original };
}

const VALID_AGGREGATORS = new Set(["sum", "min", "max", "and", "or"]);

export interface JudgeValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalScore: number;
  testCount: number;
}

export function validateTesterConfig(config: any): JudgeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (typeof config !== "object" || config === null)
    return { valid: false, errors: ["tester_config must be a JSON object."], warnings: [], totalScore: 0, testCount: 0 };
  const packages = Array.isArray(config.packages) ? config.packages : [];
  if (!packages.length) errors.push("packages must be a non-empty list.");
  let totalScore = 0;
  const allTests: string[] = [];
  packages.forEach((pkg: any, idx: number) => {
    if (typeof pkg !== "object") { errors.push(`packages[${idx}] must be an object.`); return; }
    if (!pkg.name) warnings.push(`packages[${idx}] has no descriptive English name.`);
    totalScore += Number(pkg.score) || 0;
    const tests = Array.isArray(pkg.tests) ? pkg.tests : [];
    if (!tests.length) errors.push(`packages[${idx}].tests must be a non-empty list.`);
    else allTests.push(...tests.map(String));
    if (pkg.aggregator && !VALID_AGGREGATORS.has(pkg.aggregator))
      errors.push(`packages[${idx}].aggregator '${pkg.aggregator}' is invalid.`);
  });
  if (packages.length && totalScore !== 100) errors.push(`package scores must sum to 100, got ${totalScore}.`);
  const testCount = allTests.length;
  if (new Set(allTests).size !== testCount) warnings.push("duplicate test names across packages.");
  if (config.number_of_tests !== undefined && Number(config.number_of_tests) < testCount)
    errors.push(`number_of_tests (${config.number_of_tests}) is less than the ${testCount} listed tests.`);
  if (testCount && (testCount < 20 || testCount > 30))
    warnings.push(`judge has ${testCount} tests; the house rule is 20–30.`);
  return { valid: errors.length === 0, errors, warnings, totalScore, testCount };
}

export function checkTestNames(code: string): { flagged: number; findings: { name: string; issues: string[] }[] } {
  const names = [...code.matchAll(/\bdef (test\w+)/g), ...code.matchAll(/\bfunc (Test\w+)/g)].map((m) => m[1]);
  const findings: { name: string; issues: string[] }[] = [];
  for (const name of names) {
    const issues: string[] = [];
    if (/^(test|Test)_?\d+$/.test(name)) issues.push("numbered name is not descriptive");
    if (name.length < 12) issues.push("name too short");
    if (PERSIAN.test(name)) issues.push("Persian in test name; use English");
    if (issues.length) findings.push({ name, issues });
  }
  return { flagged: findings.length, findings };
}

export function diffOutputs(expected: string, actual: string): { match: boolean; line?: number; expected?: string; actual?: string } {
  const norm = (t: string) => {
    const lines = t.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines;
  };
  const e = norm(expected), a = norm(actual);
  const max = Math.max(e.length, a.length);
  for (let i = 0; i < max; i++) {
    if (e[i] !== a[i]) return { match: false, line: i + 1, expected: e[i] ?? "<none>", actual: a[i] ?? "<none>" };
  }
  return { match: true };
}
