import * as path from "path";
import * as fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);

export const SYNC_DIR = ".quera-sync";
export const SYNC_CONFIG = `${SYNC_DIR}/config.json`;
export const WORKFLOW_PATH = ".github/workflows/quera-sync.yml";
export const DEFAULT_LESSON_FILE = "statement.md";

export interface SyncChapter {
  name: string;
  local_path: string;
  chapter_id: number;
}

export interface SyncCollege {
  college_id: number;
  landing_url?: string;
  form_base_url?: string;
  lesson_base_url?: string;
  qbox_api_base_url?: string;
  qbox_overview_base_url?: string;
}

export interface SyncConfig {
  college: SyncCollege;
  source: { root: string; lesson_file: string; ignored_dirs: string[] };
  chapters: SyncChapter[];
  deleted_lesson?: { title_template: string; description: string };
  allow_create_chapters?: boolean;
  allow_create_lessons?: boolean;
  runtime?: Record<string, unknown>;
  readonly __raw?: Record<string, unknown>;
}

export const COLLEGE_ENDPOINT_DEFAULTS = {
  form_base_url: "https://quera.org/college/assignments",
  lesson_base_url: "https://quera.org/college",
  qbox_api_base_url: "https://quera.org/qmedia/api/qmedia/assignment_owner/problem",
  qbox_overview_base_url: "https://quera.org/overview/qmedia",
} as const;

export interface LocalLesson {
  chapter: string;
  dir: string;
  title: string;
}

export class GitError extends Error {
  constructor(message: string, readonly stderr = "") {
    super(message);
    this.name = "GitError";
  }
}

export async function git(cwd: string, args: string[], timeoutMs = 120_000): Promise<string> {
  try {
    const { stdout } = await run("git", args, { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
    return stdout.trim();
  } catch (e: any) {
    const stderr = String(e?.stderr || "").trim();
    throw new GitError(`git ${args[0]} failed: ${stderr || e?.message || e}`, stderr);
  }
}

export async function readSyncConfig(root: string): Promise<SyncConfig | undefined> {
  try {
    const raw = await fs.readFile(path.join(root, SYNC_CONFIG), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed?.college?.college_id || !Array.isArray(parsed?.chapters)) return undefined;
    return {
      ...parsed,
      college: parsed.college,
      source: {
        root: parsed.source?.root || ".",
        lesson_file: parsed.source?.lesson_file || DEFAULT_LESSON_FILE,
        ignored_dirs: parsed.source?.ignored_dirs || [],
      },
      chapters: parsed.chapters,
      __raw: parsed,
    };
  } catch {
    return undefined;
  }
}

export async function findSyncRepo(roots: string[]): Promise<{ root: string; config: SyncConfig } | undefined> {
  for (const root of roots) {
    const config = await readSyncConfig(root);
    if (config) return { root, config };
  }
  return undefined;
}

export function lessonTitle(markdown: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
  }
  return "";
}

export async function collectLessons(root: string, config: SyncConfig): Promise<LocalLesson[]> {
  const lessons: LocalLesson[] = [];
  const ignored = new Set(config.source.ignored_dirs);
  for (const chapter of config.chapters) {
    const chapterDir = path.join(root, config.source.root, chapter.local_path);
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(chapterDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || ignored.has(entry.name)) continue;
      try {
        const raw = await fs.readFile(
          path.join(chapterDir, entry.name, config.source.lesson_file), "utf8");
        const title = lessonTitle(raw);
        if (!title) continue;
        lessons.push({ chapter: chapter.name, dir: `${chapter.local_path}/${entry.name}`, title });
      } catch {
      }
    }
  }
  return lessons;
}

export function lessonSlug(title: string, ordinal: number): string {
  const ascii = String(title)
    .toLowerCase()
    .replace(/[^\p{Script=Latin}\p{Nd}\s-]+/gu, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const prefix = String(ordinal).padStart(2, "0");
  return ascii ? `${prefix}-${ascii}` : `${prefix}-lesson`;
}

export async function nextLessonOrdinal(chapterDir: string): Promise<number> {
  try {
    const entries = await fs.readdir(chapterDir, { withFileTypes: true });
    const used = entries
      .filter((e) => e.isDirectory())
      .map((e) => Number(/^(\d+)/.exec(e.name)?.[1]))
      .filter((n) => Number.isFinite(n)) as number[];
    return used.length ? Math.max(...used) + 1 : 1;
  } catch {
    return 1;
  }
}

export async function createLesson(
  root: string,
  config: SyncConfig,
  chapterLocalPath: string,
  title: string,
  body = ""
): Promise<{ dir: string; file: string }> {
  const chapterDir = path.join(root, config.source.root, chapterLocalPath);
  await fs.mkdir(chapterDir, { recursive: true });
  const ordinal = await nextLessonOrdinal(chapterDir);
  let name = lessonSlug(title, ordinal);
  for (let i = 1; ; i++) {
    try {
      await fs.access(path.join(chapterDir, name));
      name = `${lessonSlug(title, ordinal)}-${i}`;
    } catch {
      break;
    }
  }
  const dir = path.join(chapterDir, name);
  await fs.mkdir(path.join(dir, "images"), { recursive: true });
  const file = path.join(dir, config.source.lesson_file);
  await fs.writeFile(file, `# ${title}\n\n${body}`, "utf8");
  return { dir, file };
}

export async function renameLessonFolder(from: string, to: string): Promise<void> {
  await fs.rename(from, to);
}

export async function deleteLessonFolder(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export async function addChapter(
  root: string,
  config: SyncConfig,
  name: string,
  localPath?: string
): Promise<SyncConfig> {
  const chapterDir = localPath
    || `${path.posix.dirname(config.chapters[0]?.local_path || ".") === "."
        ? "" : `${path.posix.dirname(config.chapters[0].local_path)}/`}chapter-${String(config.chapters.length + 1).padStart(2, "0")}`;
  const next: SyncConfig = {
    ...config,
    chapters: [...config.chapters, { name, local_path: chapterDir, chapter_id: 0 }],
  };
  await writeSyncConfig(root, next);
  return next;
}

export function renderCommitMessage(template: string, files: string[], now: Date): string {
  const names = files.map((f) => path.basename(path.dirname(f)) || path.basename(f));
  const unique = [...new Set(names)];
  const shown = unique.slice(0, 3).join("، ");
  const summary = unique.length > 3 ? `${shown} و ${unique.length - 3} مورد دیگر` : shown;
  return template
    .replace(/\$\{files\}/g, summary || "به‌روزرسانی")
    .replace(/\$\{count\}/g, String(unique.length))
    .replace(/\$\{date\}/g, now.toISOString().slice(0, 16).replace("T", " "));
}

export function hasConflicts(status: RepoStatus): boolean {
  return status.dirty.some((line) => /^(UU|AA|DD|AU|UA|DU|UD)\s/.test(line));
}

export interface RepoStatus {
  branch: string;
  ahead: number;
  behind: number;
  dirty: string[];
}

export async function repoStatus(cwd: string): Promise<RepoStatus> {
  const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const porcelain = await git(cwd, ["status", "--porcelain"]);
  const dirty = porcelain ? porcelain.split(/\r?\n/).filter(Boolean) : [];
  let ahead = 0;
  let behind = 0;
  try {
    const counts = await git(cwd, ["rev-list", "--left-right", "--count", `${branch}...@{upstream}`]);
    const [a, b] = counts.split(/\s+/).map(Number);
    ahead = a || 0;
    behind = b || 0;
  } catch { /* no upstream configured */ }
  return { branch, ahead, behind, dirty };
}

export async function cloneRepo(url: string, parentDir: string, folderName?: string): Promise<string> {
  const name = folderName || (url.split("/").pop() || "quera-course").replace(/\.git$/, "");
  await git(parentDir, ["clone", url, name], 600_000);
  return path.join(parentDir, name);
}

export async function pullRepo(cwd: string): Promise<string> {
  return git(cwd, ["pull", "--ff-only"], 300_000);
}

export async function commitAndPush(
  cwd: string,
  message: string,
  branch?: string
): Promise<string | undefined> {
  const status = await git(cwd, ["status", "--porcelain"]);
  if (!status.trim()) return undefined;
  if (branch) await ensureBranch(cwd, branch);
  await git(cwd, ["add", "-A"]);
  await git(cwd, ["commit", "-m", message]);
  const target = branch || (await currentBranch(cwd));
  await git(cwd, ["push", "-u", "origin", target], 300_000);
  return target;
}

export async function currentBranch(cwd: string): Promise<string> {
  try {
    const name = await git(cwd, ["branch", "--show-current"]);
    if (name) return name;
  } catch {
  }
  try {
    return await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    const ref = await git(cwd, ["symbolic-ref", "--short", "HEAD"]).catch(() => "");
    return ref || "main";
  }
}

export async function ensureBranch(cwd: string, branch: string): Promise<void> {
  if ((await currentBranch(cwd)) === branch) return;
  try {
    await git(cwd, ["checkout", branch]);
    return;
  } catch {
  }
  try {
    await git(cwd, ["fetch", "origin", branch], 120_000);
    await git(cwd, ["checkout", "-b", branch, `origin/${branch}`]);
    return;
  } catch {
  }
  await git(cwd, ["checkout", "-b", branch]);
}

export function buildSyncConfig(
  college: { id: number; landingUrl?: string },
  chapters: { name: string; id?: number }[],
  opts: { lessonFile?: string; sourceRoot?: string; chapterDir?: string; previous?: SyncConfig } = {}
): SyncConfig {
  const previous = opts.previous;
  const sourceRoot = opts.sourceRoot ?? previous?.source.root ?? ".";
  const chapterDir = opts.chapterDir ?? "";
  return {
    ...(previous?.__raw ?? {}),
    college: {
      ...COLLEGE_ENDPOINT_DEFAULTS,
      ...(previous?.college ?? {}),
      college_id: college.id,
      ...(college.landingUrl ? { landing_url: college.landingUrl } : {}),
    },
    source: {
      root: sourceRoot,
      lesson_file: opts.lessonFile ?? previous?.source.lesson_file ?? DEFAULT_LESSON_FILE,
      ignored_dirs: previous?.source.ignored_dirs ?? ["_reference", "quiz-src", "_imagegen"],
    },
    chapters: chapters.map((c, i) => {
      const existing = previous?.chapters.find((p) => p.name === c.name);
      return {
        name: c.name,
        local_path: existing?.local_path
          ?? `${chapterDir ? `${chapterDir}/` : ""}chapter-${String(i + 1).padStart(2, "0")}`,
        chapter_id: c.id ?? existing?.chapter_id ?? 0,
      };
    }),
    deleted_lesson: previous?.deleted_lesson ?? {
      title_template: "DELETED LESSON - {title}",
      description: "این درسنامه از مخزن حذف شده است.",
    },
    allow_create_chapters: previous?.allow_create_chapters ?? true,
    allow_create_lessons: previous?.allow_create_lessons ?? true,
    runtime: previous?.runtime ?? {
      request_delay_seconds: 1.0,
      rate_limit_sleep_seconds: 45,
      rate_limit_max_retries: 12,
      rate_limit_backoff_factor: 1.5,
      network_retry_count: 8,
      network_retry_sleep_seconds: 10,
      request_timeout_seconds: 60,
      qbox_chunk_size: 31457280,
      log_level: "INFO",
    },
  };
}

export async function writeSyncConfig(root: string, config: SyncConfig): Promise<SyncConfig> {
  const { __raw, ...serializable } = config as SyncConfig & { __raw?: unknown };
  await fs.mkdir(path.join(root, SYNC_DIR), { recursive: true });
  await fs.writeFile(
    path.join(root, SYNC_CONFIG), JSON.stringify(serializable, null, 2) + "\n", "utf8");
  for (const chapter of config.chapters) {
    const dir = path.join(root, config.source.root, chapter.local_path);
    await fs.mkdir(dir, { recursive: true });
    const keep = path.join(dir, ".gitkeep");
    try { await fs.access(keep); } catch { await fs.writeFile(keep, "", "utf8"); }
  }
  return config;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

export async function initRepo(cwd: string, remoteUrl?: string, branch = "main"): Promise<void> {
  if (!(await isGitRepo(cwd))) {
    await git(cwd, ["init"]);
    await git(cwd, ["checkout", "-b", branch]).catch(() => undefined);
  }
  if (remoteUrl) {
    await git(cwd, ["remote", "add", "origin", remoteUrl])
      .catch(() => git(cwd, ["remote", "set-url", "origin", remoteUrl]));
  }
}
