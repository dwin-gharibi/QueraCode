import { spawn } from "child_process";
import * as path from "path";

export interface Recipe {
  image: string;
  compile: string | null;
  run: string;
}

export const SANDBOX_RECIPES: Record<string, Recipe> = {
  python: { image: "python:3.12-slim", compile: null, run: "python3 {file}" },
  cpp: { image: "gcc:13", compile: "g++ -O2 -std=c++20 {file} -o sol", run: "./sol" },
  c: { image: "gcc:13", compile: "gcc -O2 -std=c17 {file} -o sol", run: "./sol" },
  java: { image: "eclipse-temurin:21-jdk", compile: "javac {file}", run: "java Main" },
  go: { image: "golang:1.22", compile: "go build -o sol {file}", run: "./sol" },
  javascript: { image: "node:20-slim", compile: null, run: "node {file}" },
  typescript: { image: "node:20-slim", compile: "npx -y tsc {file}", run: "node {stem}.js" },
  php: { image: "php:8.3-cli", compile: null, run: "php {file}" },
  ruby: { image: "ruby:3.3-slim", compile: null, run: "ruby {file}" },
  rust: { image: "rust:1.79-slim", compile: "rustc -O {file} -o sol", run: "./sol" },
  bash: { image: "bash:5.2", compile: null, run: "bash {file}" },
};

export function recipeFor(lang: string): Recipe | undefined {
  return SANDBOX_RECIPES[lang.toLowerCase()];
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

function run(cmd: string, args: string[], input: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(e), code: null, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

export async function runSample(
  lang: string,
  file: string,
  input: string,
  mode: "none" | "docker" | "local",
  timeoutMs = 8000
): Promise<RunResult & { command?: string; skipped?: boolean }> {
  const recipe = recipeFor(lang);
  if (!recipe) return { stdout: "", stderr: `No sandbox recipe for ${lang}.`, code: null, timedOut: false };
  const dir = path.dirname(file);
  const base = path.basename(file);
  const stem = base.replace(/\.[^.]+$/, "");
  const runCmd = recipe.run.replace("{file}", base).replace("{stem}", stem);
  const inner = recipe.compile
    ? `${recipe.compile.replace("{file}", base).replace("{stem}", stem)} && ${runCmd}`
    : runCmd;

  if (mode === "none") {
    const command = `docker run --rm -i --network=none -v "${dir}":/w -w /w ${recipe.image} sh -c '${inner}'`;
    return { stdout: "", stderr: "", code: null, timedOut: false, command, skipped: true };
  }
  if (mode === "docker") {
    const args = [
      "run", "--rm", "-i", "--network=none", "--memory=512m", "--cpus=1",
      "-v", `${dir}:/w`, "-w", "/w", recipe.image, "sh", "-c", inner,
    ];
    return run("docker", args, input, timeoutMs);
  }
  return run("sh", ["-c", `cd "${dir}" && ${inner}`], input, timeoutMs);
}
