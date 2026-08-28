import * as path from "path";
import * as fs from "fs/promises";
import { SYNC_DIR } from "./repo";


export const BINDINGS_FILE = `${SYNC_DIR}/bindings.json`;

export type BindingKind = "lesson" | "problem";

export interface Binding {
  kind: BindingKind;
  chapterId: number;
  itemId: number;
  area: "college" | "course" | "contest";
  collegeId?: number;
  title?: string;
  publishedAt?: string;
  pulledAt?: string;
}

export interface BindingStore {
  files: Record<string, Binding>;
}

const EMPTY: BindingStore = { files: {} };

export function bindingKey(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

export async function readBindings(root: string): Promise<BindingStore> {
  try {
    const raw = await fs.readFile(path.join(root, BINDINGS_FILE), "utf8");
    const parsed = JSON.parse(raw);
    return { files: parsed?.files && typeof parsed.files === "object" ? parsed.files : {} };
  } catch {
    return { ...EMPTY, files: {} };
  }
}

export async function writeBindings(root: string, store: BindingStore): Promise<void> {
  await fs.mkdir(path.join(root, SYNC_DIR), { recursive: true });
  const files: Record<string, Binding> = {};
  for (const key of Object.keys(store.files).sort()) files[key] = store.files[key];
  await fs.writeFile(
    path.join(root, BINDINGS_FILE),
    JSON.stringify({ files }, null, 2) + "\n",
    "utf8"
  );
}

export async function getBinding(root: string, file: string): Promise<Binding | undefined> {
  return (await readBindings(root)).files[bindingKey(root, file)];
}

export async function setBinding(root: string, file: string, binding: Binding): Promise<void> {
  const store = await readBindings(root);
  store.files[bindingKey(root, file)] = binding;
  await writeBindings(root, store);
}

export async function removeBinding(root: string, file: string): Promise<boolean> {
  const store = await readBindings(root);
  const key = bindingKey(root, file);
  if (!(key in store.files)) return false;
  delete store.files[key];
  await writeBindings(root, store);
  return true;
}

export function editPath(binding: Binding): string {
  return `${binding.area}/assignments/${binding.chapterId}/edit_problem/${binding.itemId}`;
}

export function splitTitleAndBody(markdown: string): { title?: string; body: string } {
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("# ")) {
      return {
        title: line.slice(2).trim(),
        body: lines.slice(i + 1).join("\n").replace(/^\n+/, ""),
      };
    }
    break;
  }
  return { body: String(markdown) };
}

export function joinTitleAndBody(title: string | undefined, body: string): string {
  const text = String(body || "").replace(/\r\n/g, "\n");
  if (!title) return text.endsWith("\n") ? text : `${text}\n`;
  if (new RegExp(`^\\s*#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(text.split("\n")[0] || "")) {
    return text.endsWith("\n") ? text : `${text}\n`;
  }
  return `# ${title}\n\n${text}`.replace(/\n*$/, "\n");
}
