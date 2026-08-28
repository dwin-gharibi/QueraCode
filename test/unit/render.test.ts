import * as assert from "assert";
import { renderMarkdown } from "../../src/panels/render";

describe("renderMarkdown — Quera dialect (live-reported bugs)", () => {
  it("renders multi-line <summary> blocks (details spoilers)", () => {
    const html = renderMarkdown("<details class=\"blue\">\n<summary>\nساختار فایل‌ها\n</summary>\ncontent here\n</details>");
    assert.ok(html.includes('<details class="blue">'));
    assert.ok(html.includes("<summary>"));
    assert.ok(html.includes("ساختار فایل‌ها"));
    assert.ok(html.includes("</summary>"));
    assert.ok(!html.includes("&lt;summary&gt;"), "summary must not appear as escaped text");
  });

  it("preserves <mark class title> highlights INSIDE code blocks", () => {
    const md = '```\n├── <mark class="yellow" title="این فایل باید پیاده‌سازی شود">evaluator.py</mark>\n```';
    const html = renderMarkdown(md);
    assert.ok(html.includes('<mark class="yellow" title="این فایل باید پیاده‌سازی شود">evaluator.py</mark>'));
    assert.ok(!html.includes("&lt;mark"), "mark tags must not stay escaped");
  });

  it("renders real tables with headers", () => {
    const md = "| کلاس | امتیاز |\n| --- | --- |\n| سالم | 2.5 |";
    const html = renderMarkdown(md);
    assert.ok(html.includes('<table class="mdtable">'));
    assert.ok(html.includes("<th>کلاس</th>"));
    assert.ok(html.includes("<td>2.5</td>"));
  });

  it("turns ---------- separators into <hr>", () => {
    const html = renderMarkdown("متن\n\n----------\n\nادامه");
    assert.ok(/<hr\s*\/?>/.test(html));
    assert.ok(!html.includes("<p>----------</p>"));
  });

  it("styles $$...$$ math blocks (KaTeX)", () => {
    const html = renderMarkdown("$$\nround(r2score, 3) \\times 100\n$$");
    assert.ok(html.includes('<div class="math">'));
    const oneLine = renderMarkdown("$$E = mc^2$$");
    assert.ok(oneLine.includes('<div class="math">'));
    assert.ok(oneLine.includes('class="katex"'));
  });

  it("renders nested TeX that broke live (\\frac inside ^{}, \\quad, \\ldots)", () => {
    const { prettyMath } = require("../../src/panels/render");
    assert.strictEqual(prettyMath("n \\quad k"), "n k");
    assert.strictEqual(prettyMath("a_1, a_2, \\ldots, a_n"), "a₁, a₂, …, aₙ");
    assert.strictEqual(prettyMath("10^6"), "10⁶");
    const nested = prettyMath("100 \\times e^{-\\frac{RMSE}{std(Y_{true})}}");
    assert.ok(!nested.includes("\\frac"), nested);
    assert.ok(nested.includes("RMSE") && nested.includes("∕"), nested);
  });

  it("renders markdown inside single-line <details><summary>**bold**</summary>", () => {
    const html = renderMarkdown('<details class="yellow"><summary>**دادگان**</summary>\n\nمتن **مهم**\n\n</details>');
    assert.ok(html.includes('<details class="yellow">'));
    assert.ok(html.includes("<summary><strong>دادگان</strong></summary>"));
    assert.ok(html.includes("<strong>مهم</strong>"));
  });

  it("absolutizes relative Quera links and images", () => {
    const html = renderMarkdown("[این لینک](/contest/assignments/4367/download_problem_initial_project/316832/) و ![pic](/media/img.png)");
    assert.ok(html.includes('href="https://quera.org/contest/assignments/4367/download_problem_initial_project/316832/"'));
    assert.ok(html.includes('src="https://quera.org/media/img.png"'));
  });

  it("keeps absolute links untouched", () => {
    const html = renderMarkdown("[wiki](https://en.wikipedia.org/wiki/JSON)");
    assert.ok(html.includes('href="https://en.wikipedia.org/wiki/JSON"'));
  });

  it("renders inline math and macros", () => {
    const html = renderMarkdown("قیمت $x^2$ و %problem.limits%");
    assert.ok(html.includes('class="math-inline"'));
    assert.ok(html.includes('class="macro"'));
  });

  it("keeps code fences with language badge + syntax highlighting", () => {
    const html = renderMarkdown("```python\nprint(1)\n```");
    assert.ok(html.includes('data-lang="python"'));

    assert.ok(html.replace(/<[^>]+>/g, "").includes("print(1)"));
    assert.ok(html.includes('class="hljs'));

    const json = renderMarkdown('```json\n{"a": 1}\n```');
    assert.ok(json.includes("hljs-attr") || json.includes("hljs-string"), json);

    const named = renderMarkdown('```json config.json\n{"a": 1}\n```');
    assert.ok(named.includes('data-lang="json · config.json"'), named);
  });
});

describe("relative image resolution", () => {
  it("resolves folder-relative images against the webview base", () => {
    const base = "https://file+.vscode-resource.vscode-cdn.net/repo/lesson";
    const html = renderMarkdown("![alt](images/diagram.png)", base);
    assert.ok(html.includes(`src="${base}/images/diagram.png"`), html);
  });

  it("strips a leading ./ before resolving", () => {
    const base = "https://file+.vscode-resource.vscode-cdn.net/repo/lesson";
    const html = renderMarkdown("![alt](./cover.svg)", base);
    assert.ok(html.includes(`src="${base}/cover.svg"`), html);
  });

  it("leaves absolute and quera-rooted urls alone", () => {
    const base = "https://file+.vscode-resource.vscode-cdn.net/repo/lesson";
    const html = renderMarkdown(
      "![a](https://cdn.example/x.png)\n\n![b](/qbox/download/AAA/y.png)\n\n![c](data:image/png;base64,AA)",
      base);
    assert.ok(html.includes('src="https://cdn.example/x.png"'), html);
    assert.ok(html.includes('src="https://quera.org/qbox/download/AAA/y.png"'), html);
    assert.ok(html.includes('src="data:image/png;base64,AA"'), html);
    assert.ok(!html.includes(`${base}/https:`), html);
  });

  it("leaves relative images untouched when no base is given", () => {
    const html = renderMarkdown("![alt](images/diagram.png)");
    assert.ok(html.includes('src="images/diagram.png"'), html);
  });
});
