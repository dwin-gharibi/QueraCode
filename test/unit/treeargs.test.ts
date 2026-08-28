import * as assert from "assert";
import { extractPk, idsFrom, isProblemDetail } from "../../src/args";


describe("extractPk", () => {
  it("accepts a bare id", () => {
    assert.strictEqual(extractPk(3537), 3537);
    assert.strictEqual(extractPk("3537"), 3537);
  });

  it("reads a ProblemItem, whose id lives under .problem", () => {
    const treeItem = { label: "سوال زرد", description: "EASY · 12/30", problem: { pk: 3537 } };
    assert.strictEqual(extractPk(treeItem), 3537);
  });

  it("reads a plain problem object", () => {
    assert.strictEqual(extractPk({ pk: 42 }), 42);
  });

  it("rejects nonsense instead of returning NaN", () => {
    assert.strictEqual(extractPk(undefined), undefined);
    assert.strictEqual(extractPk({}), undefined);
    assert.strictEqual(extractPk(0), undefined);
    assert.strictEqual(extractPk(-5), undefined);
    assert.strictEqual(extractPk("nope"), undefined);
  });
});

describe("isProblemDetail", () => {
  it("is false for a TreeItem, which also carries a description", () => {
    assert.strictEqual(isProblemDetail({ label: "x", description: "EASY · 1/2" }), false);
  });

  it("is true only with a statement AND an id", () => {
    assert.strictEqual(isProblemDetail({ pk: 1, description: "# عنوان" }), true);
    assert.strictEqual(isProblemDetail({ pk: 1 }), false);
    assert.strictEqual(isProblemDetail({ description: "# عنوان" }), false);
  });
});

describe("idsFrom", () => {
  it("reads named fields off a tree node", () => {
    const node = { assignmentId: 105884, problemId: 349153, label: "سوال تستی" };
    assert.deepStrictEqual(idsFrom(node, [], ["assignmentId", "problemId"]), [105884, 349153]);
  });

  it("still accepts positional ids from the palette", () => {
    assert.deepStrictEqual(idsFrom(105884, [349153], ["assignmentId", "problemId"]), [105884, 349153]);
  });

  it("reports a missing field as undefined rather than NaN", () => {
    assert.deepStrictEqual(idsFrom({ assignmentId: 7 }, [], ["assignmentId", "problemId"]), [7, undefined]);
    assert.deepStrictEqual(idsFrom(undefined, [], ["a"]), [undefined]);
  });

  it("handles the three-id college lesson row", () => {
    const node = { collegeId: 28258, chapterId: 101718, lessonId: 342073 };
    assert.deepStrictEqual(
      idsFrom(node, [], ["collegeId", "chapterId", "lessonId"]),
      [28258, 101718, 342073]
    );
  });
});
