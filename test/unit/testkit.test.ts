import * as assert from "assert";
import {
  TESTER_CPP_TEMPLATE, buildTestBundle, crc32, generateInputs, validateBundle, zipStore,
} from "../../src/testkit";

describe("generateInputs", () => {
  it("is deterministic for a given seed", () => {
    const a = generateInputs({ kind: "array", count: 4 }, 42);
    const b = generateInputs({ kind: "array", count: 4 }, 42);
    assert.deepStrictEqual(a, b);
    assert.strictEqual(a.length, 4);
  });

  it("varies with the seed", () => {
    const a = generateInputs({ kind: "array", count: 4 }, 1);
    const b = generateInputs({ kind: "array", count: 4 }, 2);
    assert.notDeepStrictEqual(a, b);
  });

  it("treats an omitted seed as 0 and accepts string seeds", () => {
    assert.deepStrictEqual(
      generateInputs({ kind: "single_int", count: 3 }),
      generateInputs({ kind: "single_int", count: 3 }, 0));
    assert.deepStrictEqual(
      generateInputs({ kind: "string", count: 2 }, "quera"),
      generateInputs({ kind: "string", count: 2 }, "quera"));
  });

  it("shapes array inputs as n then n values", () => {
    for (const input of generateInputs({ kind: "array", count: 5 }, 7)) {
      const [head, vals] = input.trimEnd().split("\n");
      assert.strictEqual(vals.split(" ").length, Number(head));
    }
  });

  it("shapes matrix inputs as 'r c' then r rows of c values", () => {
    for (const input of generateInputs({ kind: "matrix", count: 5 }, 11)) {
      const lines = input.trimEnd().split("\n");
      const [r, c] = lines[0].split(" ").map(Number);
      assert.strictEqual(lines.length, r + 1);
      for (const row of lines.slice(1)) assert.strictEqual(row.split(" ").length, c);
    }
  });

  it("lists exactly m edges in graph inputs", () => {
    for (const input of generateInputs({ kind: "graph", count: 5 }, 13)) {
      const lines = input.trimEnd().split("\n");
      const [n, m] = lines[0].split(" ").map(Number);
      assert.strictEqual(lines.length, m + 1);
      assert.ok(m >= n - 1);
      for (const edge of lines.slice(1)) {
        const [a, b] = edge.split(" ").map(Number);
        assert.ok(a >= 1 && a <= n && b >= 1 && b <= n && a !== b);
      }
    }
  });

  it("respects the string alphabet and length bounds", () => {
    for (const input of generateInputs({ kind: "string", count: 10, alphabet: "ab", lenMin: 3, lenMax: 5 }, 3)) {
      const s = input.trimEnd();
      assert.ok(s.length >= 3 && s.length <= 5);
      assert.ok(/^[ab]+$/.test(s));
    }
  });

  it("rejects bad counts and unknown kinds", () => {
    assert.throws(() => generateInputs({ kind: "array", count: 0 }), /count/);
    assert.throws(() => generateInputs({ kind: "array", count: 201 }), /count/);
    assert.throws(() => generateInputs({ kind: "nope" as any }), /kind/);
  });
});

describe("buildTestBundle", () => {
  it("lays out in/ and out/ entries and normalizes trailing newlines", () => {
    const entries = buildTestBundle([{ input: "1 2", output: "3" }, { input: "4 5\n", output: null }]);
    assert.deepStrictEqual(
      entries.map((e) => e.path),
      ["in/input1.txt", "out/output1.txt", "in/input2.txt"]);
    assert.strictEqual(entries[0].content, "1 2\n");
    assert.strictEqual(entries[2].content, "4 5\n");
  });

  it("uses the tester template when asked with a blank tester", () => {
    const entries = buildTestBundle([{ input: "1", output: "1" }], { tester: "" });
    const tester = entries.find((e) => e.path === "tester.cpp");
    assert.ok(tester);
    assert.strictEqual(tester!.content, TESTER_CPP_TEMPLATE);
  });

  it("keeps a custom tester source verbatim", () => {
    const entries = buildTestBundle([{ input: "1" }], { tester: "int main(){return 0;}" });
    assert.strictEqual(entries.find((e) => e.path === "tester.cpp")!.content, "int main(){return 0;}");
  });

  it("rejects an empty test list", () => {
    assert.throws(() => buildTestBundle([]), /non-empty/);
  });
});

describe("validateBundle", () => {
  it("accepts a complete bundle", () => {
    const v = validateBundle(
      ["in/input1.txt", "in/input2.txt", "out/output1.txt", "out/output2.txt"], false);
    assert.ok(v.valid);
    assert.deepStrictEqual(v.errors, []);
    assert.strictEqual(v.inputCount, 2);
    assert.strictEqual(v.outputCount, 2);
  });

  it("errors on inputs without outputs when there is no tester", () => {
    const v = validateBundle(["in/input1.txt"], false);
    assert.ok(!v.valid);
    assert.ok(v.errors.some((e) => e.includes("matching output")));
  });

  it("allows missing outputs when a tester.cpp is in the names", () => {
    const v = validateBundle(["in/input1.txt", "tester.cpp"], false);
    assert.ok(v.valid);
    assert.ok(v.hasTester);
    assert.ok(v.warnings.some((w) => w.includes("self-judge")));
  });

  it("honours the hasTester flag for external testers", () => {
    const v = validateBundle(["in/input1.txt"], true);
    assert.ok(v.valid);
    assert.ok(v.hasTester);
  });

  it("errors on non-contiguous numbering", () => {
    const v = validateBundle(
      ["in/input1.txt", "in/input3.txt", "out/output1.txt", "out/output3.txt"], false);
    assert.ok(!v.valid);
    assert.ok(v.errors.some((e) => e.includes("contiguously")));
  });

  it("errors with no inputs and warns about unexpected files", () => {
    const v = validateBundle(["readme.md"], false);
    assert.ok(!v.valid);
    assert.ok(v.errors.some((e) => e.includes("no in/inputN.txt")));
    assert.ok(v.warnings.some((w) => w.includes("unexpected")));
  });

  it("warns on outputs without a matching input", () => {
    const v = validateBundle(["in/input1.txt", "out/output1.txt", "out/output2.txt"], false);
    assert.ok(v.warnings.some((w) => w.includes("without a matching input")));
  });

  it("ignores directory entries", () => {
    const v = validateBundle(["in/", "in/input1.txt", "out/", "out/output1.txt"], false);
    assert.ok(v.valid);
    assert.deepStrictEqual(v.unexpected, []);
  });
});

describe("zipStore", () => {
  it("produces a zip with the PK\\x03\\x04 magic bytes", () => {
    const zip = zipStore(buildTestBundle([{ input: "1", output: "2" }]));
    assert.deepStrictEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  });

  it("writes an end-of-central-directory record with the right entry count", () => {
    const entries = buildTestBundle([{ input: "1", output: "2" }], { tester: "" });
    const zip = zipStore(entries);
    const eocd = zip.slice(zip.length - 22);
    assert.deepStrictEqual([...eocd.slice(0, 4)], [0x50, 0x4b, 0x05, 0x06]);
    const total = eocd[10] | (eocd[11] << 8);
    assert.strictEqual(total, entries.length);
    const text = Buffer.from(zip).toString("latin1");
    assert.ok(text.includes("in/input1.txt"));
    assert.ok(text.includes("out/output1.txt"));
    assert.ok(text.includes("tester.cpp"));
  });

  it("stores data uncompressed with correct sizes", () => {
    const zip = zipStore([{ path: "in/input1.txt", content: "hello\n" }]);
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    assert.strictEqual(dv.getUint16(8, true), 0);
    assert.strictEqual(dv.getUint32(18, true), 6);
    assert.strictEqual(dv.getUint32(22, true), 6);
    const nameLen = dv.getUint16(26, true);
    assert.strictEqual(nameLen, "in/input1.txt".length);
    const data = Buffer.from(zip.slice(30 + nameLen, 30 + nameLen + 6)).toString("utf8");
    assert.strictEqual(data, "hello\n");
  });

  it("computes standard CRC-32 values", () => {
    assert.strictEqual(crc32(new TextEncoder().encode("hello")), 0x3610a686);
    assert.strictEqual(crc32(new Uint8Array(0)), 0);
  });
});
