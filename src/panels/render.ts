import type { QueraSettings } from "../config";

const DEFAULT_QUERA_BASE = "https://quera.org";
let QUERA_BASE = DEFAULT_QUERA_BASE;

export function setQueraBase(url: string): void {
  QUERA_BASE = (url || DEFAULT_QUERA_BASE).replace(/\/+$/, "");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function faNum(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

export function faPercent(value: number): string {
  return `${faNum(Math.round(value))}٪`;
}

export function faDateTime(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(date);
  } catch {
    return faNum(raw.replace("T", " ").slice(0, 16));
  }
}

export function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function absolutize(url: string): string {
  if (/^(https?:|data:|#|mailto:)/i.test(url)) return url;
  if (url.startsWith("/")) return QUERA_BASE + url;
  return url;
}

function restoreMarks(escaped: string): string {
  const Q = '(?:"|&quot;)';
  const clsRe = new RegExp(`class=${Q}([a-z ]+)${Q}`, "i");
  const titleRe = new RegExp(`title=${Q}((?:(?!${Q}).)*)${Q}`, "i");
  return escaped
    .replace(/&lt;mark((?:(?!&gt;)[\s\S])*?)&gt;/g, (_m, rawAttrs: string) => {
      const cls = rawAttrs.match(clsRe)?.[1] || "";
      const title = rawAttrs.match(titleRe)?.[1] || "";
      return `<mark${cls ? ` class="${cls}"` : ""}${title ? ` title="${title}"` : ""}>`;
    })
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}

const SUPERS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", k: "ᵏ", m: "ᵐ", t: "ᵗ", " ": " ",
};
const SUBS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ",
  m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ", " ": " ",
};
const mapChars = (s: string, table: Record<string, string>, fallback: (s: string) => string): string =>
  [...s].every((c) => table[c]) ? [...s].map((c) => table[c]).join("") : fallback(s);

export function prettyMath(tex: string): string {
  let t = tex;
  for (let i = 0; i < 8; i++) {
    const before = t;
    t = t
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1) ∕ ($2)")
      .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)")
      .replace(/\\(?:text|mathrm|mathbf|mathit|mathbb|operatorname)\{([^{}]*)\}/g, "$1")
      .replace(/\^\{([^{}]*)\}/g, (_m, s) => mapChars(String(s), SUPERS, (x) => `^(${x})`))
      .replace(/_\{([^{}]*)\}/g, (_m, s) => mapChars(String(s), SUBS, (x) => `_(${x})`));
    if (t === before) break;
  }
  t = t
    .replace(/\\left|\\right/g, "")
    .replace(/\\times\b/g, "×")
    .replace(/\\cdot\b/g, "·")
    .replace(/\\div\b/g, "÷")
    .replace(/\\pm\b/g, "±")
    .replace(/\\le(q)?\b/g, "≤")
    .replace(/\\ge(q)?\b/g, "≥")
    .replace(/\\ne(q)?\b/g, "≠")
    .replace(/\\approx\b/g, "≈")
    .replace(/\\equiv\b/g, "≡")
    .replace(/\\in\b/g, "∈")
    .replace(/\\infty\b/g, "∞")
    .replace(/\\sum\b/g, "Σ")
    .replace(/\\prod\b/g, "Π")
    .replace(/\\int\b/g, "∫")
    .replace(/\\(?:l|c)?dots\b/g, "…")
    .replace(/\\(?:quad|qquad)\b/g, "  ")
    .replace(/\\sqrt\b/g, "√")
    .replace(/\\(alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega|epsilon|phi)\b/g,
      (_m, g) => ({ alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", lambda: "λ",
                    mu: "μ", pi: "π", sigma: "σ", omega: "ω", epsilon: "ε", phi: "φ" } as any)[g])
    .replace(/\\max\b/g, "max").replace(/\\min\b/g, "min")
    .replace(/\\bmod\b|\\mod\b/g, "mod")
    .replace(/\^([0-9a-zA-Z])/g, (_m, c) => SUPERS[c] || `^${c}`)
    .replace(/_([0-9a-zA-Z])(?![0-9a-zA-Z])/g, (_m, c) => SUBS[c] || `_${c}`)
    .replace(/\\\\/g, " ")
    .replace(/\\[,;!\s]/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\\(?=[A-Za-z])/g, "")
    .replace(/\s{2,}/g, " ");
  return t.trim();
}

import MarkdownIt = require("markdown-it");
import * as fs from "fs";

let katex: { renderToString(tex: string, opts?: any): string } | undefined;
try { katex = require("katex"); } catch { katex = undefined; }

export function renderTex(tex: string, display: boolean): string {
  if (katex) {
    try {
      return katex.renderToString(tex, {
        displayMode: display, throwOnError: true, strict: false, output: "htmlAndMathml",
      });
    } catch {}
  }
  return escapeHtml(prettyMath(tex));
}

function decodeEntitiesForTex(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

let katexCssCache: string | undefined;
export function katexCss(fontsBaseUri: string): string {
  if (katexCssCache === undefined) {
    try {
      katexCssCache = fs.readFileSync(require.resolve("katex/dist/katex.min.css"), "utf8");
    } catch {
      katexCssCache = "";
    }
  }
  return katexCssCache.replace(/url\(fonts\//g, `url(${fontsBaseUri}/fonts/`);
}

let hljs: { getLanguage(l: string): unknown; highlight(s: string, o: any): { value: string } } | undefined;
try { hljs = require("highlight.js/lib/common"); } catch { hljs = undefined; }

const md = new MarkdownIt({
  html: true, linkify: true, typographer: false,
  highlight: (str: string, lang: string, attrs?: string): string => {
    const label = [lang || "text", ...(attrs || "").trim().split(/\s+/).filter(Boolean)].join(" · ");
    if (hljs && lang && hljs.getLanguage(lang)) {
      try {
        const value = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="code" data-lang="${label}"><code class="hljs">${value}</code></pre>`;
      } catch {}
    }
    return "";
  },
});

function sanitize(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"');
}

function protectSpoilers(src: string): string {
  return src
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/)
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk;
      return chunk
        .replace(/<details\b([^>]*)>/gi, (_m, attrs) => {
          const cls = String(attrs).match(/class="([a-z ]+)"/i)?.[1] || "";
          return `\n@@QDETAILS${cls ? ":" + cls : ""}@@\n`;
        })
        .replace(/<\/details>/gi, "\n@@QDETAILSEND@@\n")
        .replace(/<summary>([\s\S]*?)<\/summary>/gi, (_m, t) => `\n@@QSUMMARY@@${String(t).trim()}@@QSUMMARYEND@@\n`)
        .replace(/<summary>/gi, "\n@@QSUMMARY@@\n")
        .replace(/<\/summary>/gi, "\n@@QSUMMARYEND@@\n");
    })
    .join("");
}

function extractMath(src: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];
  let text = src.replace(/\\\[([\s\S]*?)\\\]/g, (_m, tex) => `\n$$${tex}$$\n`);
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_m, tex) => {
    blocks.push(String(tex).trim());
    return `\n@@QMATH${blocks.length - 1}@@\n`;
  });
  return { text, blocks };
}

function resolveRelative(url: string, base: string): string {
  if (/^(https?:|data:|vscode-|#|mailto:)/i.test(url) || url.startsWith("/")) return url;
  const clean = url.replace(/^\.\//, "");
  const [pathPart, suffix = ""] = clean.split(/(?=[?#])/, 2);
  return `${base.replace(/\/$/, "")}/${pathPart.split("/").map(encodeURIComponent).join("/")}${suffix}`;
}

export function renderMarkdown(source: string, localBase?: string): string {
  const { text, blocks } = extractMath(protectSpoilers(source || ""));
  let html = md.render(text);
  html = sanitize(html);
  html = html.replace(/(?:<p>)?@@QMATH(\d+)@@(?:<\/p>)?/g, (_m, i) =>
    `<div class="math">${renderTex(blocks[Number(i)] || "", true)}</div>`);
  html = html.replace(/(^|[^\w$])\$([^$<>\n]+?)\$(?!\$)/g, (_m, pre, tex) =>
    `${pre}<span class="math-inline">${renderTex(decodeEntitiesForTex(String(tex)), false)}</span>`);
  html = html.replace(/%([a-z_.]+(?:_[A-Za-z0-9. ]+)?)%/g, '<span class="macro">%$1%</span>');
  html = restoreMarks(html);
  html = html.replace(/(href|src)="(\/[^"]*)"/g, (_m, attr, path) => `${attr}="${QUERA_BASE}${path}"`);
  if (localBase) {
    html = html.replace(/(src)="([^"]+)"/g, (m, attr, url) => {
      const resolved = resolveRelative(String(url), localBase);
      return resolved === url ? m : `${attr}="${resolved}"`;
    });
  }
  html = html.replace(/<pre><code class="language-([^"]*)">/g, '<pre class="code" data-lang="$1"><code>');
  html = html.replace(/<pre><code>/g, '<pre class="code" data-lang="text"><code>');
  html = html.replace(/<table>/g, '<div class="table-wrap"><table class="mdtable">')
             .replace(/<\/table>/g, "</table></div>");
  html = html
    .replace(/(?:<p>)?@@QDETAILS(?::([a-z ]+))?@@(?:<\/p>)?/g,
      (_m, cls) => `<details${cls ? ` class="${cls}"` : ""}>`)
    .replace(/(?:<p>)?@@QDETAILSEND@@(?:<\/p>)?/g, "</details>")
    .replace(/(?:<p>)?@@QSUMMARY@@([\s\S]*?)@@QSUMMARYEND@@(?:<\/p>)?/g, "<summary>$1</summary>")
    .replace(/(?:<p>)?@@QSUMMARY@@(?:<\/p>)?/g, "<summary>")
    .replace(/(?:<p>)?@@QSUMMARYEND@@(?:<\/p>)?/g, "</summary>");
  return html;
}

const I = (paths: string) =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const ICONS: Record<string, string> = {
  edit: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  save: I('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>'),
  download: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
  play: I('<polygon points="6 3 20 12 6 21 6 3"/>'),
  sparkle: I('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  filter: I('<polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3"/>'),
  refresh: I('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>'),
  rocket: I('<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2"/><path d="M12 15 9 12c1-4 4-8 10-9-1 6-5 9-9 10Z"/><circle cx="14.5" cy="9.5" r="1"/>'),
  dashboard: I('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
  beaker: I('<path d="M9 3h6"/><path d="M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3"/>'),
  chat: I('<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>'),
  book: I('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>'),
  history: I('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 3"/>'),
  zap: I('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  signin: I('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>'),
  upload: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 8 5-5 5 5"/><path d="M12 3v12"/>'),
  globe: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>'),
  image: I('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'),
  table: I('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M12 3v18"/>'),
  library: I('<path d="M4 4v16"/><path d="M9 4v16"/><path d="m13 5 5 15"/>'),
};

export const QUERA_MARK_SVG = `<svg class="qmark" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M249.35 0C111.64 0 0 111.63 0 249.34s111.64 249.34 249.35 249.34c137.71 0 249.34-111.63 249.34-249.34S387.08 0 249.35 0zm146.88 319.35a76.18 76.18 0 0 1-8.67 35.38l-122-122-32.48 32.47 150.29 150.25-16.09 16.11.15.15a122.37 122.37 0 0 0-86.55-35.85H178.97a76.5 76.5 0 0 1-76.5-76.5v-140.8a76.5 76.5 0 0 1 76.5-76.5h140.76a76.5 76.5 0 0 1 76.5 76.5z"/></svg>`;

export function btnIcon(icon: string, label: string, cmd: string, cls = "", arg?: unknown): string {
  const dataArg = arg === undefined ? "" : ` data-arg='${JSON.stringify(arg)}'`;
  return `<button ${cls ? `class="${cls}" ` : ""}data-cmd="${cmd}"${dataArg}>${ICONS[icon] || ""}<span>${label}</span></button>`;
}

const BRAND_CSS = (s: QueraSettings, fontsBase?: string) => `
${fontsBase ? `
@font-face { font-family: "Vazirmatn"; src: url("${fontsBase}/Vazirmatn-Arabic.woff2") format("woff2");
  unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFF, U+200C-200E; font-weight: 100 900; font-display: swap; }
@font-face { font-family: "Vazirmatn"; src: url("${fontsBase}/Vazirmatn-Regular.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "Vazirmatn"; src: url("${fontsBase}/Vazirmatn-Bold.woff2") format("woff2"); font-weight: 700; font-display: swap; }
` : ""}
:root {
  --q-primary: ${s.accentColor || "#0099CC"}; --q-primary-bright: #00B4E6; --q-primary-dark: #007A9E; --q-primary-soft: ${s.accentColor || "#0099CC"}1A;
  --q-ink: #0F172A; --q-muted: #64748B;
  --q-green: #10B981; --q-red: #EF4444; --q-amber: #F59E0B; --q-blue: #3B82F6;
  --q-fa: "Vazirmatn", ${s.persianFont}; --q-en: ${s.latinFont}; --q-mono: ${s.monoFont};
  --q-1: 4px; --q-2: 8px; --q-3: 12px; --q-4: 16px; --q-5: 24px; --q-6: 32px; --q-7: 48px;
  --q-r-sm: 8px; --q-r-md: 12px; --q-r-lg: 16px; --q-r-xl: 22px; --q-r-pill: 999px;
  --q-shadow-1: 0 1px 2px #0000000f, 0 1px 3px #0000001a;
  --q-shadow-2: 0 4px 12px #00000014, 0 2px 4px #0000000f;
  --q-shadow-3: 0 12px 32px #0000001f, 0 4px 8px #00000014;
  --q-ring: 0 0 0 3px ${s.accentColor || "#0099CC"}33;
  --q-border: var(--vscode-panel-border);
  --q-surface: var(--vscode-textCodeBlock-background);
}
* { box-sizing: border-box; }
body {
  font-family: var(--q-fa); line-height: 1.85; padding: 0 var(--q-5) var(--q-7); margin: 0;
  color: var(--vscode-editor-foreground); background: var(--vscode-editor-background);
  direction: ${s.editorDirection === "ltr" ? "ltr" : "rtl"};
  font-size: ${Math.max(10, Math.min(24, s.fontSize || 14.5))}px;
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  --q-fade: ${s.editorDirection === "ltr" ? "right" : "left"};
  --q-dir: ${s.editorDirection === "ltr" ? "1" : "-1"};
}
body > * { max-width: 1100px; margin-inline: auto; }

.hero {
  display: grid; gap: var(--q-5); align-items: center; margin: var(--q-4) 0 var(--q-6);
  grid-template-columns: minmax(0, 1fr);
}
@media (min-width: 760px) { .hero { grid-template-columns: 1.1fr 1fr; } }
.hero-art {
  width: 100%; height: auto; margin: 0; border-radius: var(--q-r-xl);
  box-shadow: var(--q-shadow-3); border: 1px solid var(--q-border);
}
.hero-copy { min-width: 0; }
.lead { font-size: 1.02rem; line-height: 2; color: var(--vscode-editor-foreground); opacity: .92; }
.card .hero { margin: 0 0 var(--q-4); grid-template-columns: minmax(0, 1fr); }
.card .hero img { max-width: 420px; margin-inline: auto; border-radius: var(--q-r-lg); box-shadow: var(--q-shadow-2); }
p, li, blockquote, summary, h1, h2, h3, h4, h5, h6, td, th { unicode-bidi: plaintext; text-align: start; }

.qhead {
  display: flex; align-items: center; gap: var(--q-3); padding: var(--q-5) 0 var(--q-4);
  margin-bottom: var(--q-4); position: relative;
}
.qhead::after {
  content: ""; position: absolute; inset-inline: 0; bottom: 0; height: 2px; border-radius: 2px;
  background: linear-gradient(to var(--q-fade, left), var(--q-primary), transparent 85%);
}
.qbadge {
  width: 46px; height: 46px; border-radius: var(--q-r-md); flex: none; color: #fff;
  background: linear-gradient(135deg, var(--q-primary-bright), var(--q-primary));
  display: grid; place-items: center; box-shadow: var(--q-shadow-2), 0 0 0 1px #0099CC33;
}
.qbadge .qmark { width: 26px; height: 26px; }
.qtitles { min-width: 0; }
.qtitle { font-family: var(--q-fa); font-weight: 700; font-size: 1.35rem; line-height: 1.45; unicode-bidi: plaintext; text-align: start; }
.qsubtitle { font-family: var(--q-en); font-size: .8rem; color: var(--q-muted); letter-spacing: .04em; direction: ltr; text-align: start; }
.qfoot {
  margin-top: 48px; padding-top: 14px; border-top: 1px solid var(--vscode-panel-border);
  font-family: var(--q-en); font-size: .72rem; color: var(--q-muted); opacity: .75;
  display: flex; align-items: center; gap: 8px; direction: ltr; justify-content: flex-start;
}
.qfoot .qmark { width: 13px; height: 13px; color: var(--q-primary); }

h1,h2,h3,h4 { font-family: var(--q-fa); line-height: 1.55; }
h2 { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; }
blockquote {
  margin: 10px 0; padding: 8px 16px; border-inline-start: 3px solid var(--q-primary);
  background: var(--q-primary-soft); border-radius: 8px;
}
hr { border: 0; height: 1px; margin: 22px 0;
  background: linear-gradient(90deg, transparent, var(--q-primary), transparent); }

details {
  margin: 12px 0; padding: 12px 16px; border: 1px solid var(--vscode-panel-border);
  border-inline-start: 3px solid var(--q-primary); border-radius: 10px;
  background: var(--vscode-textCodeBlock-background);
}
details > summary {
  cursor: pointer; font-weight: 700; color: var(--q-primary-dark);
  list-style-position: inside; margin: -4px 0;
}
details > summary:hover { color: var(--q-primary); }
details[open] > summary { margin-bottom: 10px; border-bottom: 1px dashed var(--vscode-panel-border); padding-bottom: 8px; }
details.blue { border-inline-start-color: var(--q-blue); background: #3B82F612; }
details.blue > summary { color: var(--q-blue); }
details.green { border-inline-start-color: var(--q-green); background: #10B98112; }
details.green > summary { color: var(--q-green); }
details.red { border-inline-start-color: var(--q-red); background: #EF444412; }
details.red > summary { color: var(--q-red); }
details.yellow, details.orange { border-inline-start-color: var(--q-amber); background: #F59E0B12; }
details.yellow > summary, details.orange > summary { color: var(--q-amber); }

mark { background: #0099CC30; color: inherit; border-radius: 4px; padding: 0 4px; cursor: help; }
mark.yellow { background: #F59E0B33; box-shadow: inset 0 -2px 0 #F59E0B; }
mark.blue { background: #3B82F633; box-shadow: inset 0 -2px 0 #3B82F6; }
mark.green { background: #10B98133; box-shadow: inset 0 -2px 0 #10B981; }
mark.red { background: #EF444433; box-shadow: inset 0 -2px 0 #EF4444; }

code { font-family: var(--q-mono); background: var(--vscode-textCodeBlock-background); padding: 1px 6px; border-radius: 4px; font-size: .92em; direction: ltr; unicode-bidi: embed; }
pre.code {
  position: relative; direction: ltr; text-align: left; background: var(--vscode-textCodeBlock-background);
  padding: 34px 16px 14px; border-radius: 12px; overflow-x: auto; border: 1px solid var(--vscode-panel-border);
  line-height: 1.65;
}
pre.code code { background: none; padding: 0; }
.hljs { color: var(--vscode-editor-foreground); }
.hljs-keyword, .hljs-selector-tag, .hljs-template-tag { color: #C586C0; }
.hljs-string, .hljs-regexp, .hljs-addition { color: #CE9178; }
.hljs-number, .hljs-literal, .hljs-symbol { color: #B5CEA8; }
.hljs-comment, .hljs-quote { color: #6A9955; font-style: italic; }
.hljs-title, .hljs-title.function_, .hljs-section { color: #DCDCAA; }
.hljs-type, .hljs-title.class_, .hljs-built_in { color: #4EC9B0; }
.hljs-attr, .hljs-attribute, .hljs-property, .hljs-variable, .hljs-params { color: #9CDCFE; }
.hljs-meta, .hljs-doctag { color: #808080; }
body.vscode-light .hljs-keyword, body.vscode-light .hljs-selector-tag, body.vscode-light .hljs-template-tag { color: #AF00DB; }
body.vscode-light .hljs-string, body.vscode-light .hljs-regexp, body.vscode-light .hljs-addition { color: #A31515; }
body.vscode-light .hljs-number, body.vscode-light .hljs-literal, body.vscode-light .hljs-symbol { color: #098658; }
body.vscode-light .hljs-comment, body.vscode-light .hljs-quote { color: #008000; }
body.vscode-light .hljs-title, body.vscode-light .hljs-section { color: #795E26; }
body.vscode-light .hljs-type, body.vscode-light .hljs-built_in { color: #267F99; }
body.vscode-light .hljs-attr, body.vscode-light .hljs-attribute, body.vscode-light .hljs-property, body.vscode-light .hljs-variable, body.vscode-light .hljs-params { color: #001080; }
pre.code::before {
  content: attr(data-lang); position: absolute; top: 8px; left: 14px;
  font-family: var(--q-mono); font-size: .7rem; letter-spacing: .08em;
  color: var(--q-primary); text-transform: uppercase;
}

.math {
  direction: ltr; text-align: center; font-family: "Georgia", "Times New Roman", serif;
  font-style: italic; font-size: 1.06em; margin: 14px auto; padding: 12px 18px;
  background: var(--q-primary-soft); border-radius: 10px; overflow-x: auto;
}
.math-inline { font-family: "Georgia", serif; font-style: italic; direction: ltr; unicode-bidi: embed; padding: 0 2px; }
.math .katex, .math-inline .katex { font-style: normal; font-family: KaTeX_Main, "Georgia", serif; }
.math .katex-display { margin: 0; }
.math-inline .katex { font-size: 1.05em; }

img { max-width: 100%; border-radius: 12px; display: block; margin: 14px auto; }
a { color: var(--q-primary-dark); text-decoration-thickness: 1px; text-underline-offset: 3px; }
a:hover { color: var(--q-primary); }
.macro { color: var(--q-primary-dark); background: #CCEEFF33; border-radius: 4px; padding: 0 5px; font-family: var(--q-mono); font-size: .88em; direction: ltr; unicode-bidi: embed; }

.table-wrap { overflow-x: auto; margin: 12px 0; border-radius: 10px; border: 1px solid var(--vscode-panel-border); }
table.mdtable { width: 100%; border-collapse: collapse; font-size: .95em; }
table.mdtable th {
  background: var(--q-primary-soft); color: var(--q-primary-dark); font-weight: 700;
  padding: 9px 14px; border-bottom: 2px solid var(--q-primary);
}
table.mdtable td { padding: 8px 14px; border-bottom: 1px solid var(--vscode-panel-border); }
table.mdtable tr:last-child td { border-bottom: 0; }
table.mdtable tr:nth-child(even) td { background: var(--q-primary-soft); }
table.mdtable .al-center { text-align: center; }
table.mdtable .al-end { text-align: end; }

.meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; align-items: center; }
.chip {
  font-family: var(--q-fa); font-size: .76rem; font-weight: 500;
  padding: 5px 13px; border-radius: var(--q-r-pill);
  background: var(--q-primary-soft); color: var(--q-primary-dark);
  border: 1px solid #0099CC2E; unicode-bidi: plaintext; line-height: 1.5;
}
.chip.diff-HARD { background: #EF44441A; color: #EF4444; border-color: #EF444440; }
.chip.diff-EASY { background: #10B9811A; color: #10B981; border-color: #10B98140; }
.chip.diff-MEDIUM { background: #0099CC1A; color: var(--q-primary); border-color: #0099CC40; }

.actions { display: flex; flex-wrap: wrap; gap: 9px; margin: 16px 0; justify-content: flex-start; }
button {
  font-family: var(--q-fa); font-size: .85rem; font-weight: 600; line-height: 1.45;
  display: inline-flex; align-items: center; justify-content: center; gap: var(--q-2);
  background: linear-gradient(180deg, var(--q-primary-bright), var(--q-primary));
  color: #fff; border: 0; padding: 9px 18px; border-radius: 10px; cursor: pointer;
  position: relative; isolation: isolate; white-space: nowrap;
  box-shadow: 0 1px 2px #0099CC33, 0 2px 8px #0099CC24, inset 0 1px 0 #ffffff40;
  transition: transform .14s cubic-bezier(.22,.61,.36,1), box-shadow .14s ease,
              filter .14s ease, background .14s ease;
}
button:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px #0099CC38, 0 8px 20px #0099CC33, inset 0 1px 0 #ffffff55;
  filter: saturate(1.08) brightness(1.03);
}
button:active { transform: translateY(0) scale(.98); filter: saturate(1) brightness(.98); }
button:focus-visible { outline: none; box-shadow: var(--q-ring), var(--q-shadow-2); }
button:disabled { opacity: .5; cursor: not-allowed; transform: none; filter: grayscale(.4); }

button.secondary {
  background: var(--q-primary-soft); color: var(--q-primary-dark);
  border: 1px solid #0099CC2E; box-shadow: none; font-weight: 500;
}
button.secondary:hover {
  background: #0099CC24; border-color: #0099CC5C; color: var(--q-primary-dark);
  box-shadow: var(--q-shadow-1); filter: none;
}
button.ghost {
  background: transparent; color: var(--q-muted); border: 0; box-shadow: none; font-weight: 500;
}
button.ghost:hover { background: var(--q-primary-soft); color: var(--q-primary-dark); box-shadow: none; }
button.danger { background: linear-gradient(180deg, #F87171, var(--q-red)); box-shadow: 0 2px 8px #EF444433, inset 0 1px 0 #ffffff40; }

button .ic { width: 15px; height: 15px; flex: none; opacity: .95; }
a:focus-visible { outline: none; box-shadow: var(--q-ring); border-radius: var(--q-r-sm); }

.card-head { display: flex; align-items: center; gap: var(--q-3); margin-bottom: var(--q-3); }
.card-head h3 { margin: 0; }
.card-art {
  width: 44px; height: 44px; flex: none; margin: 0; object-fit: contain;
  border-radius: var(--q-r-sm); background: var(--q-primary-soft); padding: 4px;
  box-shadow: none;
}

.q-divider {
  display: flex; align-items: center; gap: 14px; margin: 30px 0 16px;
  color: var(--q-primary-dark); font-weight: 700; font-size: .95rem; unicode-bidi: plaintext;
}
.q-divider::before, .q-divider::after {
  content: ""; flex: 1; height: 1px;
  background: linear-gradient(90deg, transparent, var(--q-primary), transparent);
  opacity: .5;
}
.submitbox {
  border: 1px solid #0099CC44; border-radius: var(--q-r-lg);
  padding: var(--q-4) var(--q-5); margin-bottom: var(--q-5);
  background: linear-gradient(160deg, var(--q-primary-soft), transparent 70%), var(--q-surface);
  box-shadow: var(--q-shadow-1);
}
.submitbox .actions { margin: var(--q-3) 0 var(--q-1); }
.submitbox .note {
  background: #0099CC16; color: var(--q-primary-dark); border-radius: var(--q-r-sm);
  border-inline-start: 3px solid var(--q-primary);
  padding: 10px 14px; margin: var(--q-2) 0; font-size: .88rem;
  unicode-bidi: plaintext; text-align: start;
}
.submitbox .note.closed {
  background: #EF44441A; color: var(--q-red); border-inline-start-color: var(--q-red);
}

.verdict { font-weight: 700; padding: 6px 14px; border-radius: 8px; display: inline-block; unicode-bidi: plaintext; }
.verdict.ok { background: #10B98122; color: #10B981; }
.verdict.bad { background: #EF444422; color: #EF4444; }
.verdict.warn { background: #F59E0B22; color: var(--q-amber); }

.nextstep {
  display: flex; align-items: center; gap: var(--q-4); flex-wrap: wrap;
  margin: var(--q-4) 0 var(--q-2); padding: var(--q-3) var(--q-4);
  border-radius: var(--q-r-lg); border: 1px solid #0099CC3D;
  background: linear-gradient(160deg, var(--q-primary-soft), transparent 75%), var(--q-surface);
}
.nextstep-copy { display: grid; gap: 2px; flex: 1; min-width: 200px; }
.nextstep-kicker {
  font-size: .68rem; letter-spacing: .12em; text-transform: uppercase;
  color: var(--q-primary-dark); font-weight: 700;
}
.nextstep button { padding: 11px 22px; font-size: .9rem; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important;
  }
}

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb {
  background: var(--vscode-scrollbarSlider-background, #8884); border-radius: var(--q-r-pill);
}
::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, #8886); }
::-webkit-scrollbar-track { background: transparent; }

.switch {
  display: flex; align-items: flex-start; gap: var(--q-3);
  padding: var(--q-3) 0; border-bottom: 1px dashed var(--q-border);
}
.switch:last-of-type { border-bottom: 0; }
.switch-btn { background: none; border: 0; padding: 0; box-shadow: none; flex: none; }
.switch-btn:hover { transform: none; box-shadow: none; filter: none; }
.switch-track {
  display: block; width: 42px; height: 24px; border-radius: var(--q-r-pill);
  background: var(--vscode-panel-border); position: relative;
  transition: background .18s ease;
}
.switch-knob {
  position: absolute; top: 3px; inset-inline-start: 3px; width: 18px; height: 18px;
  border-radius: 50%; background: #fff; box-shadow: var(--q-shadow-1);
  transition: transform .18s cubic-bezier(.22,.61,.36,1);
}
.switch.on .switch-track { background: var(--q-primary); }
.switch.on .switch-knob { transform: translateX(calc((42px - 24px) * var(--q-dir, -1))); }
.switch.on.danger .switch-track { background: var(--q-amber); }
.switch-copy { display: grid; gap: 2px; min-width: 0; flex: 1; }
.switch-copy b { unicode-bidi: plaintext; }
.switch-copy .dim { font-size: .8rem; line-height: 1.7; }
.switch-state {
  flex: none; font-size: .74rem; padding: 3px 10px; border-radius: var(--q-r-pill);
  background: var(--vscode-panel-border); color: var(--q-muted); align-self: center;
}
.switch.on .switch-state { background: var(--q-primary-soft); color: var(--q-primary-dark); }

.resulthead {
  border: 1px solid var(--vscode-panel-border); border-radius: 16px;
  padding: 20px 22px; margin: 16px 0 8px;
  border-inline-start: 5px solid var(--q-primary);
  background: var(--vscode-textCodeBlock-background);
}
.resulthead.ok { border-inline-start-color: var(--q-green); }
.resulthead.bad { border-inline-start-color: var(--q-red); }
.resulthead.warn { border-inline-start-color: var(--q-amber); }
.resulthead .verdict { font-size: 1.1rem; padding: 8px 18px; }
.resulthead p { margin: 12px 0 0; }
.stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.stat {
  display: grid; gap: 2px; padding: 10px 18px; border-radius: 12px; min-width: 96px;
  background: var(--q-primary-soft); text-align: center;
}
.stat b { font-size: 1.35rem; font-family: var(--q-en); color: var(--q-primary-dark); line-height: 1.2; }
.stat span { font-size: .72rem; color: var(--q-muted); }
table.results tr.ok td { color: var(--q-green); }
table.results tr.bad td { color: var(--q-red); }
table.results { width: 100%; border-collapse: collapse; }
table.results td, table.results th { border: 1px solid var(--vscode-panel-border); padding: 7px 12px; text-align: start; font-size: .85rem; unicode-bidi: plaintext; }
table.results th { background: var(--q-primary-soft); color: var(--q-primary-dark); }
.finding { padding: 8px 12px; border-radius: 8px; margin: 4px 0; text-align: start; unicode-bidi: plaintext; font-size: .85rem; }
.finding.error { background: #EF444416; border-inline-start: 3px solid #EF4444; }
.finding.warning { background: #0099CC16; border-inline-start: 3px solid #0099CC; }

.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--q-4); }
.card {
  border: 1px solid var(--q-border); border-radius: var(--q-r-lg); padding: var(--q-4) var(--q-5);
  background: var(--q-surface); box-shadow: var(--q-shadow-1);
  transition: box-shadow .2s ease, border-color .2s ease, transform .2s ease;
}
.card:hover { box-shadow: var(--q-shadow-2); border-color: #0099CC55; }
.card h3 { margin: 0 0 10px; font-size: 1rem; color: var(--q-primary-dark); unicode-bidi: plaintext; text-align: start; }
.card.center { text-align: center; }
.card .item { padding: 9px 0; border-bottom: 1px dashed var(--vscode-panel-border); }
.card .item:last-child { border-bottom: 0; }
.dim { color: var(--q-muted); font-size: .82rem; display: inline-block; unicode-bidi: plaintext; }
.row { display: flex; align-items: center; gap: 10px; }
.avatar {
  width: 46px; height: 46px; border-radius: 13px; background: linear-gradient(135deg,var(--q-primary-bright),var(--q-primary));
  color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 1.2rem; flex: none; font-family: var(--q-fa);
}
.progress { margin: 12px 0 6px; }
.progress-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  margin-bottom: 7px; font-size: .78rem;
}
.progress-label { color: var(--q-muted); unicode-bidi: plaintext; }
.progress-value { font-weight: 700; color: var(--q-primary-dark); unicode-bidi: plaintext; }
.bar {
  height: 8px; border-radius: 999px; background: var(--q-primary-soft);
  overflow: hidden; box-shadow: inset 0 0 0 1px #0099CC1F;
}
.bar-fill {
  height: 100%; border-radius: 999px; min-width: 2px;
  background: linear-gradient(90deg, var(--q-primary-bright), var(--q-primary));
  transition: width .45s cubic-bezier(.22,.61,.36,1);
}
.center-actions { justify-content: center; }
.chip.big { font-size: .85rem; padding: 6px 12px; margin: 3px; display: inline-block; text-decoration: none; }
.scores { margin-top: 10px; }
.actions.wrap { flex-wrap: wrap; }

.previewbar { position: sticky; top: 0; z-index: 5; background: var(--vscode-editor-background); padding: 8px 0; margin: 0; }
#qprogress {
  position: fixed; top: 0; inset-inline-start: 0; height: 3px; width: 0;
  background: linear-gradient(90deg, var(--q-primary-bright), var(--q-primary));
  z-index: 20; transition: width .1s linear;
}
#qmenu {
  position: absolute; z-index: 30; display: flex; gap: 6px;
  background: var(--vscode-editor-background); border: 1px solid var(--q-primary);
  border-radius: 10px; padding: 5px 7px; box-shadow: 0 6px 18px #0006;
}
#qmenu button { padding: 4px 12px; font-size: .8rem; }
#qhint { margin-top: 18px; font-size: .78rem; }
mark.q-note { cursor: help; box-shadow: inset 0 -2px 0 var(--q-blue); }
.copybtn {
  position: absolute; top: 6px; right: 10px; font-size: .68rem; padding: 3px 10px;
  background: var(--q-primary-soft); color: var(--q-primary-dark);
  border-radius: var(--q-r-sm); box-shadow: none; font-family: var(--q-fa);
  opacity: 0; transition: opacity .15s ease, background .15s ease, color .15s ease;
}
pre.code:hover .copybtn, .copybtn:focus-visible { opacity: 1; }
.copybtn:hover { background: var(--q-primary); color: #fff; transform: none; }
#toc { margin: 8px 0; }
#toc a { display: block; padding: 3px 0; text-decoration: none; font-family: var(--q-fa); unicode-bidi: plaintext; }
#toc a.toc-h3 { padding-inline-start: 18px; font-size: .88em; color: var(--q-muted); }

.qpulse-wrap { display: grid; place-items: center; min-height: 46vh; text-align: center; }
.qpulse-wrap > div { display: grid; justify-items: center; }
.qpulse {
  width: 88px; height: 88px; border-radius: 24px; color: #fff;
  background: linear-gradient(135deg, var(--q-primary-bright), var(--q-primary));
  display: grid; place-items: center; animation: qpulse 1.15s ease-in-out infinite;
  box-shadow: 0 0 0 0 #0099CC66;
}
.qpulse .qmark { width: 48px; height: 48px; }
@keyframes qpulse {
  0% { transform: scale(1); box-shadow: 0 0 0 0 #0099CC66; }
  60% { transform: scale(1.07); box-shadow: 0 0 0 26px #0099CC00; }
  100% { transform: scale(1); box-shadow: 0 0 0 0 #0099CC00; }
}
.qpulse-text { margin-top: 16px; color: var(--q-muted); font-family: var(--q-en); text-align: center; }
`;

export const PULSE_LOADER = `
<div class="qpulse-wrap"><div>
  <div class="qpulse">${QUERA_MARK_SVG}</div>
  <div class="qpulse-text">در حال دریافت از کوئرا…</div>
</div></div>`;

export interface ShellOptions {
  subtitle?: string;
  script?: string;
  fontsBase?: string;
  katexBase?: string;
  cspSource?: string;
}

export const DELEGATE_SCRIPT = `
const vscode = acquireVsCodeApi();
document.addEventListener("click", (e) => {
  const el = e.target && e.target.closest ? e.target.closest("[data-cmd]") : null;
  if (!el) return;
  e.preventDefault();
  let arg;
  if (el.dataset.arg !== undefined) { try { arg = JSON.parse(el.dataset.arg); } catch { arg = el.dataset.arg; } }
  vscode.postMessage({ type: el.dataset.cmd, arg });
});

for (const pre of document.querySelectorAll("pre.code")) {
  const btn = document.createElement("button");
  btn.className = "copybtn";
  btn.type = "button";
  btn.textContent = "کپی";
  btn.setAttribute("aria-label", "کپی این قطعه");
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const code = pre.querySelector("code");
    try {
      await navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
      btn.textContent = "✓ کپی شد";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code || pre);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      btn.textContent = "انتخاب شد";
    }
    setTimeout(() => (btn.textContent = "کپی"), 1500);
  });
  pre.appendChild(btn);
}`;

export function pageShell(title: string, body: string, s: QueraSettings, opts: ShellOptions = {}): string {
  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `img-src https: data:${opts.cspSource ? ` ${opts.cspSource}` : ""}`,
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    "font-src https: data:",
  ].join("; ");
  return `<!doctype html><html lang="${s.locale}" dir="${s.editorDirection === "ltr" ? "ltr" : "rtl"}">
<head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
${opts.katexBase ? `<style>${katexCss(opts.katexBase)}</style>` : ""}
<style>${BRAND_CSS(s, opts.fontsBase)}${s.customCss ? `\n/* user customCss */\n${s.customCss}` : ""}</style></head>
<body>
<div class="qhead"><div class="qbadge">${QUERA_MARK_SVG}</div><div class="qtitles"><div class="qtitle">${escapeHtml(title)}</div>${
  opts.subtitle ? `<div class="qsubtitle">${escapeHtml(opts.subtitle)}</div>` : ""
}</div></div>
${body}
<div class="qfoot">${QUERA_MARK_SVG} QueraCode — the Quera workbench for VS Code</div>
${opts.script ? `<script nonce="${nonce}">${opts.script}</script>` : ""}
</body></html>`;
}

export { escapeHtml };
