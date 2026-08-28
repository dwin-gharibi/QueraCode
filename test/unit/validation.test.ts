import * as assert from "assert";
import {
  checkTestNames, diffOutputs, lintMarkdown, normalizePersian, validateTesterConfig,
} from "../../src/validation";

describe("lintMarkdown", () => {
  it("flags em-dash and ascii quotes in Persian", () => {
    const f = lintMarkdown('این — تست با "نقل قول"');
    const rules = new Set(f.map((x) => x.rule));
    assert.ok(rules.has("em-dash"));
    assert.ok(rules.has("ascii-quotes"));
  });
  it("flags raw diagram fences", () => {
    const f = lintMarkdown("```mermaid\ngraph TD\n```");
    assert.ok(f.some((x) => x.rule === "raw-diagram-fence"));
  });
  it("flags forbidden headings", () => {
    const f = lintMarkdown("# داستان\nمتن");
    assert.ok(f.some((x) => x.rule === "forbidden-heading"));
  });
  it("passes clean Persian markdown", () => {
    const f = lintMarkdown("# عنوان\n\nمتن ساده.");
    assert.strictEqual(f.filter((x) => x.severity === "error").length, 0);
  });
});

describe("normalizePersian", () => {
  it("converts Arabic letters and adds ZWNJ", () => {
    const out = normalizePersian("علي كتاب می خواند");
    assert.ok(!out.text.includes("ي"));
    assert.ok(!out.text.includes("ك"));
    assert.ok(out.text.includes("می‌"));
    assert.ok(out.changed);
  });
});

describe("validateTesterConfig", () => {
  it("accepts a valid config", () => {
    const v = validateTesterConfig({
      number_of_tests: 2,
      packages: [
        { name: "A", score: 40, tests: ["test_one"], aggregator: "sum" },
        { name: "B", score: 60, tests: ["test_two"], aggregator: "min" },
      ],
    });
    assert.ok(v.valid);
    assert.strictEqual(v.totalScore, 100);
  });
  it("rejects a bad score sum", () => {
    const v = validateTesterConfig({ packages: [{ name: "A", score: 50, tests: ["t_a"] }] });
    assert.ok(!v.valid);
  });
  it("rejects number_of_tests undercount", () => {
    const v = validateTesterConfig({ number_of_tests: 1, packages: [{ name: "A", score: 100, tests: ["a", "b"] }] });
    assert.ok(!v.valid);
  });
});

describe("checkTestNames", () => {
  it("flags numbered/short test names", () => {
    const r = checkTestNames("def test1():\n  pass\ndef test_registers_a_user_properly():\n  pass");
    assert.ok(r.flagged >= 1);
  });
});

describe("diffOutputs", () => {
  it("matches with trailing whitespace tolerance", () => {
    assert.ok(diffOutputs("1\n2\n", "1 \n2").match);
  });
  it("reports the first mismatch line", () => {
    const d = diffOutputs("1\n2\n", "1\n3\n");
    assert.strictEqual(d.match, false);
    assert.strictEqual(d.line, 2);
  });
});
