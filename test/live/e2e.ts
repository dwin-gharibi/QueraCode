import * as fs from "fs";
import { QueraClient, parseProblemUrl, parseProblemLinks, parseLmsProblemPage } from "../../src/api/queraClient";
import { renderMarkdown } from "../../src/panels/render";
import { lintMarkdown, normalizePersian, validateTesterConfig, diffOutputs } from "../../src/validation";
import { extractSamples } from "../../src/samples";
import { resolveFileTypeId } from "../../src/constants";
import { readSyncConfig, collectLessons, lessonTitle } from "../../src/repo";

const SESSION = process.env.QUERA_SESSION_ID || "";
const BASE = process.env.QUERA_BASE_URL || "https://quera.org/";

const CLASS_ID = 28710;
const CLASS_ASSIGNMENT = 105409;
const CLASS_PROBLEM = 349153;
const COLLEGE_ID = 28258;
const COLLEGE_SLUG = "database-test-ai";
const COLLEGE_CHAPTER = 101718;
const COLLEGE_LESSON = 342073;
const CONTEST_ID = 105884;
const PROBLEMSET_PROBLEM = 3537;

interface Step { area: string; label: string; ok: boolean; evidence: string; }
const steps: Step[] = [];

function check(area: string, label: string, ok: boolean, evidence: unknown = ""): boolean {
  const text = typeof evidence === "string" ? evidence : JSON.stringify(evidence);
  steps.push({ area, label, ok: !!ok, evidence: (text || "").slice(0, 260) });
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${area} — ${label}`);
  if (!ok) console.log(`         ${(text || "").slice(0, 260)}`);
  return !!ok;
}

async function guard<T>(area: string, label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e: any) {
    check(area, label, false, e?.message || String(e));
    return undefined;
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<number> {
  if (!SESSION) {
    console.error("QUERA_SESSION_ID is required");
    return 2;
  }
  const client = new QueraClient({ baseUrl: BASE, sessionId: SESSION, locale: "fa" });

  console.log("\n=== auth ===");
  const me = await guard("auth", "whoami", () => client.whoami());
  check("auth", "session is authenticated", me?.is_authenticated === true, me?.username);
  check("auth", "colleges are listed on the profile",
    Array.isArray(me?.my_colleges) && me.my_colleges.length > 0,
    (me?.my_colleges || []).map((c: any) => c.id));
  await pause(1200);

  console.log("\n=== problemset ===");
  const page = await guard("problemset", "list problems", () => client.listProblems({}, 1));
  check("problemset", "a page of problems comes back", (page?.items?.length || 0) > 0, page?.count);
  check("problemset", "problem ids are numbers, not GraphQL strings",
    (page?.items || []).every((p: any) => typeof p.pk === "number"),
    (page?.items || []).slice(0, 3).map((p: any) => p.pk));
  await pause(1200);

  const problem = await guard("problemset", "get one problem",
    () => client.getProblem(PROBLEMSET_PROBLEM));
  check("problemset", "the requested problem is returned",
    Number(problem?.pk) === PROBLEMSET_PROBLEM, problem?.pk);
  check("problemset", "its statement is present", (problem?.description?.length || 0) > 100,
    (problem?.description || "").slice(0, 80));
  check("problemset", "allowed file types are listed",
    (problem?.allowed_file_types?.length || 0) > 0,
    (problem?.allowed_file_types || []).slice(0, 3));

  const samples = extractSamples(problem?.description || "");
  check("problemset", "sample tests are extracted from the statement",
    samples.length > 0, samples.slice(0, 1));
  const html = renderMarkdown(problem?.description || "");
  check("problemset", "the statement renders to HTML", html.length > 200, html.slice(0, 80));
  check("problemset", "quera-rooted images are absolutized",
    !/src="\/(?!\/)/.test(html), "no bare /… src remained");
  await pause(1200);

  console.log("\n=== url parsing ===");
  check("urls", "problemset url", JSON.stringify(parseProblemUrl("https://quera.org/problemset/3537"))
    === JSON.stringify({ kind: "problemset", problemId: 3537 }));
  const asg = parseProblemUrl(`https://quera.org/course/assignments/${CLASS_ASSIGNMENT}/problems/${CLASS_PROBLEM}`);
  check("urls", "course assignment url", asg?.assignmentId === CLASS_ASSIGNMENT
    && asg?.problemId === CLASS_PROBLEM && asg?.area === "course", asg);
  const contestUrl = parseProblemUrl(`https://quera.org/contest/assignments/${CONTEST_ID}/problems/1`);
  check("urls", "contest url keeps its area", contestUrl?.area === "contest", contestUrl);

  console.log("\n=== LMS class ===");
  const classes = await guard("class", "list my classes", () => client.getClasses());
  check("class", "the target class is listed",
    (classes?.items || []).some((c: any) => Number(c.id) === CLASS_ID),
    (classes?.items || []).map((c: any) => c.id));
  check("class", "instructor never renders as [object Object]",
    (classes?.items || []).every((c: any) => typeof c.instructor !== "object"),
    (classes?.items || []).map((c: any) => c.instructor));
  await pause(1200);

  const items = await guard("class", "list assignment problems",
    () => client.listAssignmentItems(CLASS_ASSIGNMENT, "course"));
  check("class", "the assignment's problems are found", (items?.length || 0) >= 2, items?.length);
  check("class", "every item has a name", (items || []).every((i) => !!i.name),
    (items || []).map((i) => i.name).slice(0, 4));
  await pause(1200);

  const detail = await guard("class", "open a class problem",
    () => client.getAssignmentProblem(CLASS_ASSIGNMENT, CLASS_PROBLEM, "course"));
  check("class", "the problem is named after itself, not the assignment",
    detail?.name === items?.find((i) => i.id === CLASS_PROBLEM)?.name,
    { got: detail?.name });
  check("class", "its statement Markdown is present",
    (detail?.description?.length || 0) > 20, (detail?.description || "").slice(0, 60));
  await pause(1200);

  const subs = await guard("class", "read the submissions table",
    () => client.getAssignmentSubmissions(CLASS_ASSIGNMENT, "course"));
  check("class", "submissions read without throwing", Array.isArray(subs), subs?.length);
  await pause(1200);

  console.log("\n=== college ===");
  const chapters = await guard("college", "list chapters",
    () => client.getCollegeChapters(COLLEGE_ID, COLLEGE_SLUG));
  check("college", "chapters are listed", (chapters?.chapters?.length || 0) > 5,
    chapters?.chapters?.length);
  const chapter = (chapters?.chapters || []).find((c) => c.id === COLLEGE_CHAPTER);
  check("college", "the target chapter is present", !!chapter, chapter?.name);
  check("college", "lessons are typed",
    (chapter?.items || []).some((i) => i.kind === "lesson" || i.kind === "problem"),
    (chapter?.items || []).map((i) => `${i.name}:${i.kind}`).slice(0, 3));
  await pause(1200);

  const lesson = await guard("college", "open a lesson",
    () => client.getCollegeLesson(COLLEGE_ID, COLLEGE_CHAPTER, COLLEGE_LESSON));
  check("college", "the lesson body is retrievable", !!lesson?.current, Object.keys(lesson?.current || {}).slice(0, 6));
  await pause(1200);

  console.log("\n=== contest ===");
  const contestItems = await guard("contest", "list contest problems",
    () => client.listAssignmentItems(CONTEST_ID, "contest"));
  check("contest", "the contest reads without error", Array.isArray(contestItems), contestItems?.length);
  await pause(1200);
  const board = await guard("contest", "read the scoreboard",
    () => client.getScoreboardMarkdown(CONTEST_ID, "contest"));
  check("contest", "the scoreboard renders as Markdown",
    typeof board === "string" && board.includes("#"), (board || "").slice(0, 70));

  console.log("\n=== offline logic ===");
  const lint = lintMarkdown("# سلام\n\nمتن — با خط تیره\n");
  check("logic", "the linter flags an em-dash in Persian",
    lint.some((f) => f.rule === "em-dash"), lint.map((f) => f.rule));
  const norm = normalizePersian("كتاب هاي على");
  check("logic", "Arabic letters normalize (incl. alef maksura)",
    norm.text === "کتاب های علی", norm.text);
  const tester = validateTesterConfig({
    packages: [
      { name: "test_basic", score: 50, tests: ["adds two positive numbers"] },
      { name: "test_edge", score: 50, tests: ["handles a zero operand"] },
    ],
  });
  check("logic", "a valid tester_config passes", tester.valid === true, tester.errors);
  check("logic", "its scores total 100", tester.totalScore === 100, tester.totalScore);
  const bad = validateTesterConfig({
    packages: [{ name: "only", score: 70, tests: ["x"] }],
  });
  check("logic", "a config whose scores miss 100 is rejected", bad.valid === false, bad.errors);
  check("logic", "identical outputs diff as equal", diffOutputs("6\n", "6\n").match === true);
  check("logic", "different outputs diff as unequal", diffOutputs("6\n", "7\n").match === false);
  check("logic", "python resolves to a judge file type", resolveFileTypeId("J", "python") === 5,
    resolveFileTypeId("J", "python"));

  const localHtml = renderMarkdown("![d](images/x.png)", "https://webview.test/root");
  check("logic", "folder-relative images resolve for local previews",
    localHtml.includes('src="https://webview.test/root/images/x.png"'), localHtml.slice(0, 120));

  console.log("\n=== course repo ===");
  const FORK = "/Users/dwin/Desktop/quera-tmp/repo-fork";
  if (fs.existsSync(`${FORK}/.quera-sync/config.json`)) {
    const cfg = await readSyncConfig(FORK);
    check("repo", "the sync config is read", !!cfg, cfg?.college?.college_id);
    const lessons = cfg ? await collectLessons(FORK, cfg) : [];
    check("repo", "lessons are discovered with titles",
      lessons.length > 0 && lessons.every((l) => l.title.length > 0), lessons.length);
    check("repo", "lesson titles come from the first H1",
      lessonTitle("# عنوان\n\nمتن") === "عنوان");
  } else {
    check("repo", "fork repo present for the repo checks", false, `${FORK} not found`);
  }

  const failed = steps.filter((s) => !s.ok);
  console.log(`\n=== ${steps.length - failed.length}/${steps.length} checks passed ===`);
  for (const f of failed) console.log(`  FAIL [${f.area}] ${f.label}: ${f.evidence}`);

  const outFlag = process.argv.indexOf("--out");
  if (outFlag > -1 && process.argv[outFlag + 1]) {
    const areas = [...new Set(steps.map((s) => s.area))];
    const lines = [
      "# QueraCode — live verification report", "",
      `Run: ${new Date().toISOString()}  ·  target: \`${BASE}\``, "",
      `**${steps.length - failed.length}/${steps.length} checks passed**`, "",
      "| area | check | result | evidence |", "| --- | --- | --- | --- |",
      ...areas.flatMap((area) => steps.filter((s) => s.area === area).map((s) =>
        `| ${area} | ${s.label} | ${s.ok ? "PASS" : "**FAIL**"} | \`${s.evidence.replace(/\|/g, "\\|")}\` |`)),
    ];
    fs.writeFileSync(process.argv[outFlag + 1], lines.join("\n"), "utf8");
    console.log(`report → ${process.argv[outFlag + 1]}`);
  }
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code));
