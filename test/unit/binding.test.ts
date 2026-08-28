import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  bindingKey, editPath, getBinding, joinTitleAndBody, readBindings, removeBinding,
  setBinding, splitTitleAndBody, writeBindings,
} from "../../src/binding";

describe("splitTitleAndBody", () => {
  it("separates the H1 from the statement", () => {
    const { title, body } = splitTitleAndBody("# عنوان درسنامه\n\nمتن اصلی.\n");
    assert.strictEqual(title, "عنوان درسنامه");
    assert.strictEqual(body, "متن اصلی.\n");
  });

  it("skips blank lines before the heading", () => {
    assert.strictEqual(splitTitleAndBody("\n\n# سلام\n\nمتن").title, "سلام");
  });

  it("reports no title when the file opens with prose", () => {
    const { title, body } = splitTitleAndBody("یک پاراگراف\n\n# دیرهنگام\n");
    assert.strictEqual(title, undefined);
    assert.ok(body.startsWith("یک پاراگراف"));
  });

  it("ignores an h2", () => {
    assert.strictEqual(splitTitleAndBody("## زیرعنوان\n\nمتن").title, undefined);
  });

  it("survives an empty document", () => {
    assert.deepStrictEqual(splitTitleAndBody(""), { body: "" });
  });
});

describe("joinTitleAndBody", () => {
  it("puts the remote title back as an H1", () => {
    assert.strictEqual(joinTitleAndBody("عنوان", "متن"), "# عنوان\n\nمتن\n");
  });

  it("does not add a second heading when the body already has it", () => {
    const out = joinTitleAndBody("عنوان", "# عنوان\n\nمتن\n");
    assert.strictEqual((out.match(/^# عنوان$/gm) || []).length, 1, out);
  });

  it("round-trips with splitTitleAndBody", () => {
    const original = "# عنوان درسنامه\n\nمتن اصلی.\n";
    const { title, body } = splitTitleAndBody(original);
    assert.strictEqual(joinTitleAndBody(title, body), original);
  });

  it("handles a missing title", () => {
    assert.strictEqual(joinTitleAndBody(undefined, "متن"), "متن\n");
  });
});

describe("editPath", () => {
  it("routes a college lesson and an LMS problem differently", () => {
    assert.strictEqual(
      editPath({ kind: "lesson", area: "college", chapterId: 101718, itemId: 342073 }),
      "college/assignments/101718/edit_problem/342073");
    assert.strictEqual(
      editPath({ kind: "problem", area: "course", chapterId: 105409, itemId: 349153 }),
      "course/assignments/105409/edit_problem/349153");
  });
});

describe("binding storage", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "qc-bind-")); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it("keys files relative to the repo so a clone elsewhere still matches", () => {
    const key = bindingKey(root, path.join(root, "course", "chapter-01", "01-intro", "statement.md"));
    assert.strictEqual(key, "course/chapter-01/01-intro/statement.md");
  });

  it("round-trips a binding through disk", async () => {
    const file = path.join(root, "a", "statement.md");
    await setBinding(root, file, {
      kind: "lesson", area: "college", chapterId: 7, itemId: 42, title: "عنوان",
    });
    const back = await getBinding(root, file);
    assert.strictEqual(back?.itemId, 42);
    assert.strictEqual(back?.title, "عنوان");
  });

  it("removes a binding and reports whether there was one", async () => {
    const file = path.join(root, "b", "statement.md");
    assert.strictEqual(await removeBinding(root, file), false);
    await setBinding(root, file, { kind: "problem", area: "course", chapterId: 1, itemId: 2 });
    assert.strictEqual(await removeBinding(root, file), true);
    assert.strictEqual(await getBinding(root, file), undefined);
  });

  it("returns an empty store for a folder that has none", async () => {
    assert.deepStrictEqual(await readBindings(root), { files: {} });
  });

  it("writes keys sorted, so two authors do not fight over ordering", async () => {
    await writeBindings(root, { files: {
      "z.md": { kind: "lesson", area: "college", chapterId: 1, itemId: 1 },
      "a.md": { kind: "lesson", area: "college", chapterId: 1, itemId: 2 },
    } });
    const raw = fs.readFileSync(path.join(root, ".quera-sync", "bindings.json"), "utf8");
    assert.ok(raw.indexOf('"a.md"') < raw.indexOf('"z.md"'), raw);
  });

  it("survives a corrupt bindings file instead of throwing", async () => {
    fs.mkdirSync(path.join(root, ".quera-sync"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quera-sync", "bindings.json"), "{ not json", "utf8");
    assert.deepStrictEqual(await readBindings(root), { files: {} });
  });
});
