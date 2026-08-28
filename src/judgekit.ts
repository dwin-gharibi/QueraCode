export interface JudgeKind {
  key: string;
  label: string;
  detail: string;
  files: Record<string, string>;
}

const TESTER_CONFIG = (signature: string, single: boolean, tests: string[][]): string =>
  JSON.stringify(
    {
      version: 2,
      solution_signature: signature,
      can_submit_single_file: single,
      ...(single ? { single_file_path: signature } : {}),
      number_of_tests: tests.reduce((n, t) => n + t.length, 0),
      packages: tests.map((t, i) => ({
        name: i === 0 ? "Sanity Check" : `Feature ${i}`,
        score: i === 0 ? 20 : Math.floor(80 / Math.max(1, tests.length - 1)),
        tests: t,
        aggregator: i === 0 ? "min" : "sum",
      })),
    },
    null,
    2
  ) + "\n";

export const JUDGE_KINDS: JudgeKind[] = [
  {
    key: "python",
    label: "Python (unittest)",
    detail: "test.py + sample_test.py · .qtest/.qsampletest",
    files: {
      "tester_config.json": TESTER_CONFIG("main.py", true, [["test_runs"], ["test_basic", "test_edge_cases"]]),
      valid_files: "main.py\n",
      ".qtest": "test.py\n",
      ".qsampletest": "sample_test.py\n",
      "test.py": `import unittest\nfrom main import *\n\n\nclass TestAll(unittest.TestCase):\n    def test_runs(self):\n        self.assertTrue(True)\n\n    def test_basic(self):\n        pass\n\n    def test_edge_cases(self):\n        pass\n\n\nif __name__ == "__main__":\n    unittest.main()\n`,
      "sample_test.py": `import unittest\nfrom main import *\n\n\nclass TestSample(unittest.TestCase):\n    def test_sample(self):\n        pass\n\n\nif __name__ == "__main__":\n    unittest.main()\n`,
      "main.py": "# کد اولیهٔ کاربر — solution signature\n",
    },
  },
  {
    key: "devops",
    label: "DevOps (Docker / Compose)",
    detail: "test.py at ROOT only — no .qtest / sample tests; compose v3, ≤5 services",
    files: {
      "tester_config.json": TESTER_CONFIG("docker-compose.yml", false,
        [["test_compose_up"], ["test_service_health", "test_wiring"]]),
      valid_files: "Dockerfile\ndocker-compose.yml\napp/**/*\n",
      "test.py": `"""DevOps judge — runs at project root. Install phase has network; test phase does NOT.\nBuild real containers, probe real behavior (docker compose exec / HTTP / kubectl)."""\nimport subprocess\nimport unittest\n\n\ndef sh(cmd: str) -> subprocess.CompletedProcess:\n    return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=300)\n\n\nclass TestStack(unittest.TestCase):\n    @classmethod\n    def setUpClass(cls):\n        assert sh("docker compose up -d --build").returncode == 0\n\n    @classmethod\n    def tearDownClass(cls):\n        sh("docker compose down -v")\n\n    def test_compose_up(self):\n        out = sh("docker compose ps --status running --format '{{.Name}}'")\n        self.assertTrue(out.stdout.strip())\n\n    def test_service_health(self):\n        pass  # probe HTTP / exec here\n\n    def test_wiring(self):\n        pass  # inter-service checks here\n\n\nif __name__ == "__main__":\n    unittest.main()\n`,
      "docker-compose.yml": `version: "3"\nservices:\n  app:\n    build: .\n    ports:\n      - "8080:8080"\n`,
      "requirements.txt": "requests\n",
      "fixtures/.gitkeep": "",
    },
  },
  {
    key: "jest",
    label: "Frontend unit (Jest)",
    detail: "JS/TS unit tests in Node + jsdom",
    files: {
      "tester_config.json": TESTER_CONFIG("src/solution.js", true, [["runs"], ["basic_cases", "edge_cases"]]),
      valid_files: "src/solution.js\n",
      ".qtest": "tests/main.test.js\n",
      ".qsampletest": "tests/main.sample.test.js\n",
      "package.json": `{\n  "private": true,\n  "scripts": { "test": "jest" },\n  "devDependencies": { "jest": "^29.0.0" }\n}\n`,
      "jest.config.js": "module.exports = { testEnvironment: 'jsdom' };\n",
      "tests/main.test.js": `const solution = require("../src/solution");\n\ntest("runs", () => expect(typeof solution).toBeDefined());\ntest("basic_cases", () => {});\ntest("edge_cases", () => {});\n`,
      "tests/main.sample.test.js": `test("sample", () => {});\n`,
      "src/solution.js": "// کد اولیهٔ کاربر\nmodule.exports = {};\n",
    },
  },
  {
    key: "cypress",
    label: "Frontend E2E (Cypress)",
    detail: "real-browser end-to-end judge",
    files: {
      "tester_config.json": TESTER_CONFIG("index.html", false, [["page_loads"], ["interactions"]]),
      valid_files: "index.html\nstyles/**/*\nscripts/**/*\n",
      ".qtest": "cypress/e2e/main.cy.js\n",
      ".qsampletest": "cypress/e2e/sample.cy.js\n",
      "cypress.config.js": `module.exports = { e2e: { supportFile: false } };\n`,
      "cypress/e2e/main.cy.js": `describe("app", () => {\n  it("page_loads", () => { cy.visit("index.html"); });\n  it("interactions", () => {});\n});\n`,
      "cypress/e2e/sample.cy.js": `it("sample", () => { cy.visit("index.html"); });\n`,
      "index.html": "<!doctype html><html><body><!-- کد اولیهٔ کاربر --></body></html>\n",
    },
  },
  {
    key: "django",
    label: "Django (pytest/unittest)",
    detail: "project judge for Django apps",
    files: {
      "tester_config.json": TESTER_CONFIG("manage.py", false, [["test_migrations"], ["test_models", "test_views"]]),
      valid_files: "manage.py\napp/**/*.py\nproject/**/*.py\nrequirements.txt\n",
      ".qtest": "test.py\n",
      ".qsampletest": "sample_test.py\n",
      "test.py": `import unittest\n\n\nclass TestDjango(unittest.TestCase):\n    def test_migrations(self):\n        pass\n\n    def test_models(self):\n        pass\n\n    def test_views(self):\n        pass\n`,
      "sample_test.py": `import unittest\n\n\nclass TestSample(unittest.TestCase):\n    def test_sample(self):\n        pass\n`,
      "requirements.txt": "django\n",
    },
  },
];

export function extractTestNames(source: string): string[] {
  const names: string[] = [];
  for (const m of source.matchAll(/def\s+(test_\w+)\s*\(/g)) names.push(m[1]);
  for (const m of source.matchAll(/(?:test|it)\(\s*["'`]([^"'`]+)["'`]/g)) names.push(m[1]);
  return [...new Set(names)];
}

export function generateTesterConfig(signature: string, single: boolean, testNames: string[]): string {
  if (!testNames.length) return TESTER_CONFIG(signature, single, [["test_runs"]]);
  const sanity = testNames.filter((t) => /runs|sanity|structure|smoke/i.test(t));
  const rest = testNames.filter((t) => !sanity.includes(t));
  const groups: string[][] = [];
  if (sanity.length) groups.push(sanity);
  const byPrefix = new Map<string, string[]>();
  for (const t of rest) {
    const prefix = t.replace(/^test_/, "").split("_")[0] || t;
    byPrefix.set(prefix, [...(byPrefix.get(prefix) || []), t]);
  }
  groups.push(...byPrefix.values());
  return TESTER_CONFIG(signature, single, groups.length ? groups : [testNames]);
}

export function generateValidFiles(paths: string[]): string {
  const skip = /^(tester_config\.json|valid_files|\.qtest|\.qsampletest|test\.py|sample_test\.py|.*\.test\.js|.*\.cy\.js)$/;
  const keep = paths
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => !skip.test(p.split("/").pop() || "") && !p.startsWith("cypress/") && !p.startsWith("tests/"))
    .sort();
  return keep.join("\n") + (keep.length ? "\n" : "");
}
