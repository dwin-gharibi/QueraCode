import * as assert from "assert";
import { explainError, allowedLanguagesLabel, languageForFile, submitTarget } from "../../src/submit";

describe("explainError", () => {
  const cases: [number, RegExp][] = [
    [400, /malformed|missing language/i],
    [401, /not signed in/i],
    [403, /permission|deadline/i],
    [404, /not found/i],
    [429, /rate-limit/i],
    [500, /server error/i],
    [503, /server error/i],
  ];
  for (const [status, expected] of cases) {
    it(`explains HTTP ${status} in terms of a cause`, () => {
      const msg = explainError({ message: `Quera returned HTTP ${status} during X.`, status }, "Submit");
      assert.ok(expected.test(msg), `${status}: ${msg}`);
      assert.ok(msg.includes("Submit"), msg);
    });
  }

  it("reads the status out of the message when none is attached", () => {
    const msg = explainError(new Error("Quera returned HTTP 404 during GET problemset/1234."), "Open problem");
    assert.ok(/not found/i.test(msg), msg);
  });

  it("keeps the original text for non-HTTP failures", () => {
    const msg = explainError(new Error("socket hang up"), "Sync");
    assert.ok(msg.includes("socket hang up"), msg);
  });
});

describe("submitTarget", () => {
  it("routes a problemset problem to the problemset endpoint", () => {
    assert.deepStrictEqual(submitTarget({ assignment: { pk: 246 } }), { aid: null, area: "problemset" });
  });
  it("keeps a course problem on its assignment", () => {
    assert.deepStrictEqual(submitTarget({ assignment: { pk: 105409 }, area: "course" }),
      { aid: 105409, area: "course" });
  });
  it("keeps a contest problem on its assignment", () => {
    assert.deepStrictEqual(submitTarget({ assignment: { pk: 105884 }, area: "contest" }),
      { aid: 105884, area: "contest" });
  });
});

describe("allowedLanguagesLabel", () => {
  it("lists labels with extensions", () => {
    const text = allowedLanguagesLabel([{ label: "Python 3.12", extension: ".py" }, { label: "C++" }]);
    assert.strictEqual(text, "Python 3.12 (.py), C++");
  });
  it("says so when the problem advertises none", () => {
    assert.ok(/none/i.test(allowedLanguagesLabel([])));
    assert.ok(/none/i.test(allowedLanguagesLabel(undefined)));
  });
});

describe("languageForFile", () => {
  it("maps an extension to its language", () => {
    assert.strictEqual(languageForFile("/a/main.py", "cpp"), "python");
  });
  it("falls back for an unknown extension", () => {
    assert.strictEqual(languageForFile("/a/notes.xyz", "cpp"), "cpp");
  });
});

describe("parseJudgeResult", () => {
  const { parseJudgeResult, verdictForStatus } = require("../../src/submit");
  const ACCEPTED = '<span class="shj_g">Compiled Successfully</span>\n'
    + '<span class="shj_b">Test 1</span>\n<span class="shj_g">ACCEPTED</span>\n'
    + '<span class="shj_b">Test 2</span>\n<span class="shj_g">ACCEPTED</span>';
  const TLE = '<span class="shj_g">Compiled Successfully</span>\n'
    + '<span class="shj_b">Test 1</span>\n<span class="shj_o">Time Limit Exceeded</span>\n'
    + '<span class="shj_b">Test 2</span>\n<span class="shj_o">Killed by a signal</span>';

  it("parses every test out of Quera's HTML blob", () => {
    const r = parseJudgeResult(ACCEPTED);
    assert.strictEqual(r.total, 2);
    assert.strictEqual(r.passed, 2);
    assert.strictEqual(r.verdict, "AC");
    assert.strictEqual(r.accepted, true);
    assert.strictEqual(r.compile, "Compiled Successfully");
    assert.deepStrictEqual(r.tests.map((t: any) => t.status), ["ACCEPTED", "ACCEPTED"]);
  });

  it("reports the first failing verdict", () => {
    const r = parseJudgeResult(TLE);
    assert.strictEqual(r.passed, 0);
    assert.strictEqual(r.total, 2);
    assert.strictEqual(r.verdict, "TLE");
    assert.strictEqual(r.accepted, false);
  });

  it("survives a missing or non-string payload", () => {
    for (const bad of [undefined, null, 42, {}, ""]) {
      const r = parseJudgeResult(bad as any);
      assert.strictEqual(r.total, 0);
      assert.strictEqual(r.accepted, false);
      assert.strictEqual(r.verdict, "NJ");
    }
  });

  it("maps judge wording onto verdict codes", () => {
    assert.strictEqual(verdictForStatus("ACCEPTED"), "AC");
    assert.strictEqual(verdictForStatus("Time Limit Exceeded"), "TLE");
    assert.strictEqual(verdictForStatus("Memory Limit Exceeded"), "MLE");
    assert.strictEqual(verdictForStatus("Wrong Answer"), "WA");
    assert.strictEqual(verdictForStatus("Killed by a signal"), "RE");
  });
});

describe("isRateLimited", () => {
  const { isRateLimited } = require("../../src/api/queraClient");
  it("detects a 429", () => assert.strictEqual(isRateLimited(429, ""), true));
  it("detects the WAF page served with a 200", () => {
    assert.strictEqual(isRateLimited(200, "<html><title>به کجا چنین شتابان</title></html>"), true);
  });
  it("passes real content through", () => {
    assert.strictEqual(isRateLimited(200, "<html>real content</html>"), false);
  });
  it("does not confuse other failures for throttling", () => {
    assert.strictEqual(isRateLimited(404, ""), false);
    assert.strictEqual(isRateLimited(500, ""), false);
  });
});
