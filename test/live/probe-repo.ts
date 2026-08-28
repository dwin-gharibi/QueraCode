import * as path from "path";
import { readSyncConfig, collectLessons } from "../../src/repo";

const ROOT = process.env.QUERA_REPO || path.join(__dirname, "..", "..", "repo-fork");

(async () => {
  const cfg = await readSyncConfig(ROOT);
  if (!cfg) {
    console.error(`FAIL: ${ROOT} is not recognised as a Quera course repo`);
    process.exit(1);
  }
  const bases = ["form_base_url", "lesson_base_url", "qbox_api_base_url", "qbox_overview_base_url"];
  console.log("root            :", ROOT);
  console.log("college_id      :", cfg.college.college_id);
  console.log("landing_url     :", cfg.college.landing_url);
  console.log("endpoint bases  :", bases.filter((k) => (cfg.college as any)[k]).length, "of 4 preserved");
  console.log("lesson_file     :", cfg.source.lesson_file);
  console.log("source.root     :", JSON.stringify(cfg.source.root));
  console.log("ignored_dirs    :", JSON.stringify(cfg.source.ignored_dirs));
  console.log("chapters        :", cfg.chapters.length);
  console.log("deleted_lesson  :", cfg.deleted_lesson ? "preserved" : "*** DROPPED ***");
  console.log("allow_create_*  :", cfg.allow_create_chapters, cfg.allow_create_lessons);
  console.log("runtime keys    :", cfg.runtime ? Object.keys(cfg.runtime).length : "*** DROPPED ***");

  const lessons = await collectLessons(ROOT, cfg);
  console.log("\nlessons found   :", lessons.length);
  for (const l of lessons.slice(0, 4)) console.log(`   ${l.dir}  ::  «${l.title}»`);

  const perChapter = new Map<string, number>();
  for (const l of lessons) perChapter.set(l.chapter, (perChapter.get(l.chapter) || 0) + 1);
  console.log("\nper chapter:");
  for (const c of cfg.chapters) {
    console.log(`   ${String(perChapter.get(c.name) ?? 0).padStart(3)}  ${c.local_path}  ${c.name}`);
  }

  const empty = cfg.chapters.filter((c) => !perChapter.get(c.name)).length;
  if (!lessons.length) { console.error("\nFAIL: no lessons discovered at all"); process.exit(1); }
  console.log(`\nOK: ${lessons.length} lessons across ${perChapter.size} chapters (${empty} chapter folders empty)`);
})().catch((e) => { console.error("FAILED:", e?.message || e); process.exit(1); });
