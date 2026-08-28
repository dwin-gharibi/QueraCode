export const TESTER_CPP_TEMPLATE = `// tester.cpp — Sharif-Judge / Quera "tester method".
// Run per test as:  ./tester <input> <jury_output> <user_output>
//   argv[1] = test input file
//   argv[2] = jury (correct) output file
//   argv[3] = participant (user) output file
// Exit code: 0 => accepted, 1 => wrong answer.
#include <bits/stdc++.h>
using namespace std;

static vector<string> tokens(const string &path) {
    ifstream f(path);
    vector<string> t;
    string s;
    while (f >> s) t.push_back(s);
    return t;
}

static bool compare(const string &input_file,
                    const vector<string> &jury,
                    const vector<string> &user) {
    (void)input_file;
    if (jury.size() != user.size()) return false;
    for (size_t i = 0; i < jury.size(); ++i)
        if (jury[i] != user[i]) return false;
    return true;
}

int main(int argc, char **argv) {
    if (argc < 4) return 1;
    vector<string> jury = tokens(argv[2]);
    vector<string> user = tokens(argv[3]);
    return compare(argv[1], jury, user) ? 0 : 1;
}
`;

export const TESTER_CONTRACT = {
  runAs: "./tester <input_file> <jury_output_file> <user_output_file>",
  argv: {
    "argv[1]": "test input file path",
    "argv[2]": "jury (correct/expected) output file path",
    "argv[3]": "participant (user) output file path",
  },
  exitCode: { "0": "accepted (correct)", "1": "wrong answer" },
  docs: "https://github.com/mjnaderi/Sharif-Judge/blob/docs/v1.4/tests_structure.md#tester-method",
} as const;

export interface FileEntry {
  path: string;
  content: string;
}

export interface TestCase {
  input: string;
  output?: string | null;
}

const INPUT_RE = /^in(?:put)?\/?input(\d+)\.txt$/i;
const OUTPUT_RE = /^out(?:put)?\/?output(\d+)\.txt$/i;

function normText(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text && !text.endsWith("\n") ? text + "\n" : text;
}

export interface BundleOptions {
  tester?: string;
  includeOutputs?: boolean;
}

export function buildTestBundle(tests: TestCase[], opts: BundleOptions = {}): FileEntry[] {
  if (!Array.isArray(tests) || !tests.length) {
    throw new Error("tests must be a non-empty list of {input, output} objects.");
  }
  const includeOutputs = opts.includeOutputs !== false;
  const entries: FileEntry[] = [];
  tests.forEach((test, i) => {
    const index = i + 1;
    entries.push({ path: `in/input${index}.txt`, content: normText(test.input) });
    if (includeOutputs && test.output !== null && test.output !== undefined) {
      entries.push({ path: `out/output${index}.txt`, content: normText(test.output) });
    }
  });
  if (opts.tester !== undefined) {
    entries.push({ path: "tester.cpp", content: opts.tester.trim() ? opts.tester : TESTER_CPP_TEMPLATE });
  }
  return entries;
}

export interface BundleValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  inputCount: number;
  outputCount: number;
  hasTester: boolean;
  unexpected: string[];
}

export function validateBundle(names: string[], hasTester: boolean): BundleValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const inputs = new Set<number>();
  const outputs = new Set<number>();
  const unexpected: string[] = [];
  let tester = hasTester;
  for (const name of names) {
    if (name.endsWith("/")) continue;
    if (name.toLowerCase() === "tester.cpp" || name.toLowerCase() === "tester.cc") {
      tester = true;
      continue;
    }
    const inMatch = INPUT_RE.exec(name);
    const outMatch = OUTPUT_RE.exec(name);
    if (inMatch) inputs.add(Number(inMatch[1]));
    else if (outMatch) outputs.add(Number(outMatch[1]));
    else unexpected.push(name);
  }

  if (!inputs.size) errors.push("no in/inputN.txt files found.");
  for (const [label, nums] of [["input", inputs], ["output", outputs]] as const) {
    const sorted = [...nums].sort((a, b) => a - b);
    if (sorted.length && !sorted.every((v, i) => v === i + 1)) {
      errors.push(`${label} files must be numbered contiguously from 1; got [${sorted.join(", ")}].`);
    }
  }
  if (!tester) {
    const missing = [...inputs].filter((n) => !outputs.has(n)).sort((a, b) => a - b);
    if (missing.length) {
      errors.push(`inputs without a matching output (and no tester.cpp): [${missing.join(", ")}].`);
    }
    const extra = [...outputs].filter((n) => !inputs.has(n)).sort((a, b) => a - b);
    if (extra.length) warnings.push(`outputs without a matching input: [${extra.join(", ")}].`);
  } else if (!outputs.size) {
    warnings.push("tester.cpp present with no out/ files — the tester must self-judge.");
  }
  if (unexpected.length) {
    warnings.push(`unexpected files (ignored by the judge): [${unexpected.join(", ")}].`);
  }

  return {
    valid: !errors.length,
    errors,
    warnings,
    inputCount: inputs.size,
    outputCount: outputs.size,
    hasTester: tester,
    unexpected,
  };
}

export const INPUT_KINDS = ["single_int", "array", "matrix", "string", "graph", "pairs"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

export interface InputSpec {
  kind?: InputKind;
  count?: number;
  nMin?: number;
  nMax?: number;
  vMin?: number;
  vMax?: number;
  rowsMin?: number;
  rowsMax?: number;
  colsMin?: number;
  colsMax?: number;
  lenMin?: number;
  lenMax?: number;
  alphabet?: string;
  edgeRatio?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed?: number | string): number {
  if (seed === undefined) return 0;
  if (typeof seed === "number") return Math.trunc(seed) >>> 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function randInt(rng: () => number, lo: number, hi: number): number {
  if (hi < lo) [lo, hi] = [hi, lo];
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function generateInputs(spec: InputSpec, seed?: number | string): string[] {
  const kind = String(spec.kind ?? "array").toLowerCase();
  if (!(INPUT_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`kind must be one of ${INPUT_KINDS.join(", ")}; got '${spec.kind}'.`);
  }
  const count = Math.trunc(Number(spec.count ?? 5));
  if (!Number.isFinite(count) || count <= 0 || count > 200) {
    throw new Error("count must be between 1 and 200.");
  }
  const rng = mulberry32(hashSeed(seed));

  const vMin = Math.trunc(Number(spec.vMin ?? -1000));
  const vMax = Math.trunc(Number(spec.vMax ?? 1000));
  const nMin = Math.trunc(Number(spec.nMin ?? 1));
  const nMax = Math.trunc(Number(spec.nMax ?? 20));

  const inputs: string[] = [];
  for (let i = 0; i < count; i++) {
    if (kind === "single_int") {
      inputs.push(`${randInt(rng, vMin, vMax)}\n`);
    } else if (kind === "array") {
      const n = randInt(rng, nMin, nMax);
      const vals = Array.from({ length: n }, () => String(randInt(rng, vMin, vMax))).join(" ");
      inputs.push(`${n}\n${vals}\n`);
    } else if (kind === "matrix") {
      const r = randInt(rng, Math.trunc(Number(spec.rowsMin ?? 1)), Math.trunc(Number(spec.rowsMax ?? 10)));
      const c = randInt(rng, Math.trunc(Number(spec.colsMin ?? 1)), Math.trunc(Number(spec.colsMax ?? 10)));
      const rows = Array.from({ length: r }, () =>
        Array.from({ length: c }, () => String(randInt(rng, vMin, vMax))).join(" ")
      ).join("\n");
      inputs.push(`${r} ${c}\n${rows}\n`);
    } else if (kind === "string") {
      const alphabet = spec.alphabet || "abcdefghijklmnopqrstuvwxyz";
      const length = randInt(rng, Math.trunc(Number(spec.lenMin ?? 1)), Math.trunc(Number(spec.lenMax ?? 20)));
      let s = "";
      for (let j = 0; j < length; j++) s += alphabet[randInt(rng, 0, alphabet.length - 1)];
      inputs.push(`${s}\n`);
    } else if (kind === "pairs") {
      const n = randInt(rng, nMin, nMax);
      const lines = Array.from({ length: n }, () =>
        `${randInt(rng, vMin, vMax)} ${randInt(rng, vMin, vMax)}`
      ).join("\n");
      inputs.push(`${n}\n${lines}\n`);
    } else {
      const n = randInt(rng, Math.max(2, nMin), Math.max(2, nMax));
      const ratio = Number(spec.edgeRatio ?? 1.5);
      const maxEdges = (n * (n - 1)) / 2;
      const m = Math.min(maxEdges, Math.max(n - 1, Math.trunc(n * ratio)));
      const seen = new Set<string>();
      const edges: [number, number][] = [];
      for (let v = 2; v <= n; v++) {
        const u = randInt(rng, 1, v - 1);
        edges.push([u, v]);
        seen.add(`${Math.min(u, v)},${Math.max(u, v)}`);
      }
      while (edges.length < m) {
        const a = randInt(rng, 1, n);
        const b = randInt(rng, 1, n);
        if (a === b) continue;
        const key = `${Math.min(a, b)},${Math.max(a, b)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([a, b]);
      }
      const body = edges.map(([a, b]) => `${a} ${b}`).join("\n");
      inputs.push(`${n} ${edges.length}\n${body}\n`);
    }
  }
  return inputs;
}

let CRC_TABLE: Uint32Array | undefined;

function crcTable(): Uint32Array {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  return CRC_TABLE;
}

export function crc32(data: Uint8Array): number {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

export function zipStore(entries: FileEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const data = encoder.encode(entry.content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const out = new Uint8Array(offset + centralSize + eocd.length);
  let pos = 0;
  for (const part of [...parts, ...centrals, eocd]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}
