import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  addChapter, buildSyncConfig, collectLessons, commitAndPush, createLesson, currentBranch,
  deleteLessonFolder, ensureBranch, git, hasConflicts, initRepo, isGitRepo, lessonSlug,
  nextLessonOrdinal, pullRepo, readSyncConfig, renameLessonFolder, renderCommitMessage,
  repoStatus, writeSyncConfig,
} from "../../src/repo";


const argSource = process.argv.indexOf("--source");
const SOURCE = argSource > -1 ? process.argv[argSource + 1]
  : path.join(__dirname, "..", "..", "repo-fork");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail: unknown = "") => {
  const text = typeof detail === "string" ? detail : JSON.stringify(detail);
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${text ? ` — ${String(text).slice(0, 160)}` : ""}`);
  ok ? pass++ : fail++;
  return ok;
};

async function main(): Promise<number> {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "queracode-reposync-"));
  const remote = path.join(scratch, "remote.git");
  const work = path.join(scratch, "work");
  console.log(`scratch: ${scratch}\nsource : ${SOURCE}\n`);

  console.log("=== setup ===");
  if (!(await readSyncConfig(SOURCE))) {
    check("source is a Quera course repo", false, `${SOURCE} has no .quera-sync/config.json`);
    return 1;
  }
  await fs.mkdir(remote, { recursive: true });
  await git(scratch, ["init", "--bare", "remote.git"]);
  await git(scratch, ["clone", remote, "work"]).catch(() => undefined);
  await fs.mkdir(work, { recursive: true });
  await initRepo(work, remote, "main");
  await git(work, ["config", "user.email", "queracode@example.test"]);
  await git(work, ["config", "user.name", "QueraCode Test"]);
  check("scratch working copy is a git repo", await isGitRepo(work));

  await fs.cp(path.join(SOURCE, ".quera-sync"), path.join(work, ".quera-sync"), { recursive: true });
  await fs.cp(path.join(SOURCE, "course"), path.join(work, "course"), { recursive: true });

  console.log("\n=== config round-trip ===");
  const cfg = await readSyncConfig(work);
  if (!check("config parses", !!cfg)) return 1;
  check("endpoint bases preserved",
    !!cfg!.college.form_base_url && !!cfg!.college.qbox_api_base_url);
  check("deleted_lesson preserved", !!cfg!.deleted_lesson, cfg!.deleted_lesson?.title_template);
  check("runtime preserved", Object.keys(cfg!.runtime || {}).length >= 5);

  const rebuilt = buildSyncConfig(
    { id: cfg!.college.college_id, landingUrl: cfg!.college.landing_url },
    cfg!.chapters.map((c) => ({ name: c.name, id: c.chapter_id })),
    { lessonFile: cfg!.source.lesson_file, previous: cfg! }
  );
  await writeSyncConfig(work, rebuilt);
  const after = await readSyncConfig(work);
  check("rewrite keeps every college endpoint",
    ["form_base_url", "lesson_base_url", "qbox_api_base_url", "qbox_overview_base_url"]
      .every((k) => (after!.college as any)[k] === (cfg!.college as any)[k]));
  check("rewrite keeps runtime block",
    JSON.stringify(after!.runtime) === JSON.stringify(cfg!.runtime));
  check("rewrite keeps chapter paths",
    after!.chapters.every((c, i) => c.local_path === cfg!.chapters[i].local_path),
    after!.chapters.slice(0, 2).map((c) => c.local_path).join(", "));
  check("rewrite keeps the lesson filename", after!.source.lesson_file === cfg!.source.lesson_file);

  console.log("\n=== lesson discovery ===");
  const lessons = await collectLessons(work, after!);
  check("lessons discovered", lessons.length > 0, `${lessons.length} lessons`);
  check("every lesson has a title", lessons.every((l) => l.title.length > 0));
  check("lessons map to configured chapters",
    lessons.every((l) => after!.chapters.some((c) => c.name === l.chapter)));

  console.log("\n=== commit + push to a named branch ===");
  await commitAndPush(work, "seed", "main");
  const TARGET = "queracode/auto-sync";
  await fs.writeFile(
    path.join(work, "course", "chapter-00-introduction", "01-preface", "statement.md"),
    "# پیش‌گفتار: چرا مدیریت محصول هوش مصنوعی؟\n\nیک ویرایش آزمایشی.\n", "utf8");
  const msg = renderCommitMessage("درسنامه: ${files} (QueraCode)", ["course/chapter-00-introduction/01-preface/statement.md"], new Date());
  check("commit message renders", !msg.includes("${"), msg);
  const branch = await commitAndPush(work, msg, TARGET);
  check("pushed to the requested branch", branch === TARGET, branch);
  check("HEAD is on that branch", (await currentBranch(work)) === TARGET);
  const remoteBranches = await git(remote, ["branch", "--list"]);
  check("remote received the branch", remoteBranches.includes(TARGET), remoteBranches.replace(/\s+/g, " "));

  console.log("\n=== a second edit commits again ===");
  await fs.writeFile(
    path.join(work, "course", "chapter-00-introduction", "02-course-overview", "statement.md"),
    "# نگاه کلی به کالج و اهداف دوره\n\nویرایش دوم.\n", "utf8");
  const second = await commitAndPush(work, "second edit", TARGET);
  check("second push succeeds", second === TARGET, second);
  const log = await git(work, ["log", "--oneline", "-3"]);
  check("both commits are on the branch", log.split("\n").length >= 3, log.replace(/\n/g, " | "));

  console.log("\n=== no-op push is a no-op ===");
  const nothing = await commitAndPush(work, "should not commit", TARGET);
  check("clean tree produces no commit", nothing === undefined);

  console.log("\n=== status + pull ===");
  const st = await repoStatus(work);
  check("status reads the branch", st.branch === TARGET, JSON.stringify(st));
  check("clean tree reports no changes", st.dirty.length === 0);
  check("no false conflict", !hasConflicts(st));
  const pulled = await pullRepo(work).catch((e) => `ERR ${e.message}`);
  check("pull is a fast-forward no-op", !String(pulled).startsWith("ERR"), String(pulled).split("\n")[0]);

  console.log("\n=== branch switching ===");
  await ensureBranch(work, "main");
  check("switched back to main", (await currentBranch(work)) === "main");
  await ensureBranch(work, TARGET);
  check("switched to an existing branch", (await currentBranch(work)) === TARGET);
  await ensureBranch(work, "queracode/brand-new");
  check("created a branch that did not exist", (await currentBranch(work)) === "queracode/brand-new");

  console.log("\n=== authoring: create / rename / delete ===");
  const cfgNow = (await readSyncConfig(work))!;
  const chapter = cfgNow.chapters[0];

  const TITLE = "درسنامهٔ آزمایشی QueraCode";
  const made = await createLesson(work, cfgNow, chapter.local_path, TITLE);
  const madeBody = await fs.readFile(made.file, "utf8");
  check("new lesson writes the title as its H1", madeBody.startsWith(`# ${TITLE}`), madeBody.split("\n")[0]);
  check("new lesson uses the configured filename",
    path.basename(made.file) === cfgNow.source.lesson_file, path.basename(made.file));
  check("new lesson gets an images folder",
    await fs.stat(path.join(made.dir, "images")).then(() => true).catch(() => false));

  let found = (await collectLessons(work, cfgNow)).find((l) => l.title === TITLE);
  check("the sync would discover the new lesson", !!found, found?.dir);

  check("a Persian title yields an ascii-safe folder",
    /^\d\d-[\w-]*$/.test(path.basename(made.dir)), path.basename(made.dir));
  check("an English title keeps its words", lessonSlug("Chapter Objectives", 7) === "07-chapter-objectives",
    lessonSlug("Chapter Objectives", 7));
  check("ordinals continue from what exists",
    (await nextLessonOrdinal(path.join(work, cfgNow.source.root, chapter.local_path))) > 1);

  const renamed = path.join(path.dirname(made.dir), "99-renamed-lesson");
  await renameLessonFolder(made.dir, renamed);
  found = (await collectLessons(work, cfgNow)).find((l) => l.title === TITLE);
  check("renaming the folder keeps the lesson identity (its H1)", !!found?.dir.endsWith("99-renamed-lesson"), found?.dir);

  const withChapter = await addChapter(work, cfgNow, "فصل آزمایشی");
  check("chapter appended to the config",
    withChapter.chapters.some((c) => c.name === "فصل آزمایشی"));
  const reread = (await readSyncConfig(work))!;
  check("chapter survives a round-trip", reread.chapters.length === cfgNow.chapters.length + 1);
  check("adding a chapter keeps the runtime block", !!reread.runtime && Object.keys(reread.runtime).length >= 5);

  const pushed = await commitAndPush(work, "authoring changes", TARGET);
  check("authoring changes commit and push", pushed === TARGET, pushed);

  await deleteLessonFolder(renamed);
  found = (await collectLessons(work, cfgNow)).find((l) => l.title === TITLE);
  check("deleted lesson disappears from discovery", !found);
  const afterDelete = await commitAndPush(work, "remove lesson", TARGET);
  check("the deletion is committed too", afterDelete === TARGET, afterDelete);
  check("deleted_lesson template is available to the sync",
    !!reread.deleted_lesson?.title_template, reread.deleted_lesson?.title_template);

  console.log("\n=== conflict detection ===");
  check("porcelain conflict markers are recognised",
    hasConflicts({ branch: "x", ahead: 0, behind: 0, dirty: ["UU course/a/statement.md"] }));
  check("ordinary edits are not conflicts",
    !hasConflicts({ branch: "x", ahead: 0, behind: 0, dirty: [" M course/a/statement.md", "?? new.md"] }));

  await fs.rm(scratch, { recursive: true, force: true });
  console.log(`\n=== ${pass}/${pass + fail} checks passed ===`);
  return fail ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
