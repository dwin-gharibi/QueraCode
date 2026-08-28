import * as vscode from "vscode";


export type EditTargetResolver = (fsPath: string) => { name: string; problemId: number } | undefined;

export class QueraLensProvider implements vscode.CodeLensProvider {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  constructor(private readonly resolveTarget?: EditTargetResolver) {}

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (doc.languageId !== "markdown") return [];
    const lenses: vscode.CodeLens[] = [];
    const top = new vscode.Range(0, 0, 0, 0);
    const at = (line: number) => new vscode.Range(line, 0, line, 0);

    const target = this.resolveTarget?.(doc.uri.fsPath);
    if (target) {
      lenses.push(new vscode.CodeLens(top, {
        title: `$(cloud-upload) Publish to Quera — «${target.name}»`,
        command: "queracode.publishAssignmentEdit",
      }));
    }

    lenses.push(
      new vscode.CodeLens(top, { title: "$(check) Validate", command: "queracode.validateMarkdown" }),
      new vscode.CodeLens(top, { title: "$(open-preview) Preview RTL", command: "queracode.previewMarkdown" }),
      new vscode.CodeLens(top, { title: "$(cloud-upload) Publish", command: "queracode.publishLesson" }),
      new vscode.CodeLens(top, { title: "$(beaker) + Sample test", command: "queracode.insertSampleTest" }),
      new vscode.CodeLens(top, { title: "$(code) + Code block", command: "queracode.insertCodeBlock" }),
      new vscode.CodeLens(top, { title: "$(table) + Limits", command: "queracode.insertLimits" }),
      new vscode.CodeLens(top, { title: "$(fold-down) + Accordion", command: "queracode.insertAccordion" })
    );

    for (let i = 0; i < doc.lineCount; i++) {
      const text = doc.lineAt(i).text;
      if (/^##\s+/.test(text)) {
        lenses.push(
          new vscode.CodeLens(at(i), { title: "$(beaker) sample here", command: "queracode.insertSampleTest", arguments: [i + 1] }),
          new vscode.CodeLens(at(i), { title: "$(code) code here", command: "queracode.insertCodeBlock", arguments: [i + 1] }),
          new vscode.CodeLens(at(i), { title: "$(fold-down) accordion here", command: "queracode.insertAccordion", arguments: [i + 1] })
        );
      }
    }
    return lenses;
  }

  refresh(): void {
    this._onDidChange.fire();
  }
}

export const SAMPLE_TEST_SNIPPET = `
## نمونه ورودی ۱

\`\`\`
2 3
\`\`\`

## نمونه خروجی ۱

\`\`\`
5
\`\`\`
`;

export const LIMITS_SNIPPET = `
%problem.limits%

| محدودیت | مقدار |
| --- | --- |
| زمان | ۱ ثانیه |
| حافظه | ۲۵۶ مگابایت |
`;

export const ACCORDION_SNIPPET = `
<details class="blue">
<summary>راهنمایی</summary>

اینجا محتوای بخش بازشونده را بنویسید.

</details>
`;

export function codeBlockSnippet(lang: string): string {
  return `\n\`\`\`${lang}\n// your code here\n\`\`\`\n`;
}
