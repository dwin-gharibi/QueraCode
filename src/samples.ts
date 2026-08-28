export interface Sample {
  source: "macro" | "fenced";
  input: string | null;
  output: string | null;
  testId?: number;
}

export function extractSamples(md: string): Sample[] {
  const samples: Sample[] = [];
  const macroRe = /%problem\.test_(\d+)%/g;
  let m: RegExpExecArray | null;
  while ((m = macroRe.exec(md))) samples.push({ source: "macro", input: null, output: null, testId: Number(m[1]) });
  if (samples.length) return samples;

  const fenceRe = /```[^\n]*\n([\s\S]*?)```/g;
  const blocks: { pos: number; content: string }[] = [];
  while ((m = fenceRe.exec(md))) blocks.push({ pos: m.index, content: m[1].replace(/\n+$/, "") });
  const cuesOut = ["خروجی", "output", "نمونه خروجی", "sample output"];
  const cuesIn = ["ورودی", "input", "نمونه ورودی", "sample input"];
  let pendingInput: string | null = null;
  for (const b of blocks) {
    const pre = md.slice(Math.max(0, b.pos - 80), b.pos).toLowerCase();
    const isOut = cuesOut.some((c) => pre.includes(c));
    const isIn = cuesIn.some((c) => pre.includes(c));
    if (isOut && pendingInput !== null) {
      samples.push({ source: "fenced", input: pendingInput, output: b.content });
      pendingInput = null;
    } else if (isIn || pendingInput === null) {
      pendingInput = b.content;
    }
  }
  return samples;
}
