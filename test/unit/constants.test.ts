import * as assert from "assert";
import { resolveTag, resolveFileTypeId, verdictOf, langByKey } from "../../src/constants";
import { extractSamples } from "../../src/samples";
import { scaffold } from "../../src/snippets";

describe("constants", () => {
  it("resolves tag names and ids", () => {
    assert.strictEqual(resolveTag("Python"), 78);
    assert.strictEqual(resolveTag(78), 78);
    assert.strictEqual(resolveTag("گراف"), 83);
    assert.strictEqual(resolveTag("nope"), undefined);
  });

  it("resolves file-type ids namespaced per judge kind", () => {
    assert.strictEqual(resolveFileTypeId("J", "go"), 40);
    assert.strictEqual(resolveFileTypeId("J", "c"), 1);
    assert.strictEqual(resolveFileTypeId("C", "c"), 14);
    assert.strictEqual(resolveFileTypeId("U", "zip"), 7);
    assert.strictEqual(resolveFileTypeId("PJ", "django"), 42);
  });

  it("maps verdicts", () => {
    assert.strictEqual(verdictOf("AC")?.accepted, true);
    assert.strictEqual(verdictOf("WA")?.accepted, false);
  });

  it("has language info", () => {
    assert.strictEqual(langByKey("python")?.ext, ".py");
  });
});

describe("samples", () => {
  it("extracts macro samples", () => {
    const s = extractSamples("نمونه:\n\n%problem.test_1%\n%problem.test_2%");
    assert.strictEqual(s.length, 2);
    assert.strictEqual(s[0].testId, 1);
  });
  it("extracts fenced input/output", () => {
    const s = extractSamples("ورودی\n```\n1 2\n```\nخروجی\n```\n3\n```");
    assert.ok(s.length >= 1);
    assert.strictEqual(s[0].input, "1 2");
    assert.strictEqual(s[0].output, "3");
  });
});

describe("scaffold", () => {
  it("generates a python scaffold with a title header", () => {
    const code = scaffold("python", "Test");
    assert.ok(code.includes("# Solution for: Test"));
    assert.ok(code.includes("sys.stdin.read"));
  });
});
