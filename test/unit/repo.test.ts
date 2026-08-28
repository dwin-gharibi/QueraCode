import * as assert from "assert";
import { lessonTitle } from "../../src/repo";

describe("lessonTitle", () => {
  it("takes the first level-1 heading", () => {
    assert.strictEqual(lessonTitle("# عنوان درسنامه\n\nمتن"), "عنوان درسنامه");
  });

  it("skips front matter and prose before the heading", () => {
    assert.strictEqual(lessonTitle("\n\nintro line\n\n# The Title\n\nbody"), "The Title");
  });

  it("ignores deeper headings", () => {
    assert.strictEqual(lessonTitle("## Not this\n\n# This one"), "This one");
  });

  it("returns empty when there is no H1 (the sync cannot match such a file)", () => {
    assert.strictEqual(lessonTitle("## only h2\n\ntext"), "");
  });

  it("trims surrounding whitespace", () => {
    assert.strictEqual(lessonTitle("   #    Spaced Title   \n"), "Spaced Title");
  });
});

describe("readSyncConfig + collectLessons against the real fork repo", () => {
  const FORK = "/Users/dwin/Desktop/quera-tmp/repo-fork";
  const has = require("fs").existsSync(`${FORK}/.quera-sync/config.json`);

  (has ? it : it.skip)("reads the committed sync config", async () => {
    const { readSyncConfig } = require("../../src/repo");
    const cfg = await readSyncConfig(FORK);
    assert.ok(cfg, "expected a SyncConfig");
    assert.strictEqual(cfg.college.college_id, 28780);
    assert.strictEqual(cfg.source.lesson_file, "statement.md");
    assert.ok(cfg.chapters.length >= 10, `chapters: ${cfg.chapters.length}`);
  });

  (has ? it : it.skip)("collects lessons with titles from every chapter", async () => {
    const { readSyncConfig, collectLessons } = require("../../src/repo");
    const cfg = await readSyncConfig(FORK);
    const lessons = await collectLessons(FORK, cfg);
    assert.ok(lessons.length > 0, "expected lessons");
    for (const l of lessons) {
      assert.ok(l.title.length > 0, `untitled lesson at ${l.dir}`);
      assert.ok(l.dir.startsWith("course/"), l.dir);
      assert.ok(cfg.chapters.some((c: any) => c.name === l.chapter), l.chapter);
    }
  });

  (has ? it : it.skip)("skips the configured ignored directories", async () => {
    const { readSyncConfig, collectLessons } = require("../../src/repo");
    const cfg = await readSyncConfig(FORK);
    const lessons = await collectLessons(FORK, cfg);
    for (const ignored of cfg.source.ignored_dirs) {
      assert.ok(!lessons.some((l: any) => l.dir.endsWith(`/${ignored}`)),
        `ignored dir leaked: ${ignored}`);
    }
  });

  it("returns undefined for a folder that is not a course repo", async () => {
    const { readSyncConfig } = require("../../src/repo");
    assert.strictEqual(await readSyncConfig("/tmp"), undefined);
  });
});
