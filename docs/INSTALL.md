# QueraCode — install & first-run guide

This is the end-to-end walkthrough: install the extension, sign in to Quera,
solve and submit your first problem, author content as staff, and (optionally)
wire up an AI provider and coder agents.

> **Prerequisites** — VS Code **1.85+**. For "Run on Samples" in Docker mode you
> also need Docker; otherwise set `queracode.sandbox` to `local` or `none`.
> Quera sits behind a geo-restriction + WAF, so network features need egress
> that reaches `quera.org` (i.e. from inside Iran or through your own proxy).

## 1. Install

### From the `.vsix` (recommended)

Any one of:

- Drag `queracode-0.1.0.vsix` onto the **Extensions** view.
- `Ctrl/Cmd+Shift+P` → **Extensions: Install from VSIX…** → pick the file.
- Terminal: `code --install-extension queracode-0.1.0.vsix`

### From source

```bash
cd queracode
npm install
npm run compile      # strict tsc build
npm run unit         # 67 unit tests must pass
npm run package      # produces queracode.vsix (via @vscode/vsce)
```

Or open the folder in VS Code and press **F5** for an Extension Development
Host.

## 2. Sign in

QueraCode never puts credentials in `settings.json` — secrets live in VS Code
**SecretStorage**.

**Option A — session id (fastest).**
1. Log in to [quera.org](https://quera.org) in your browser.
2. DevTools → Application/Storage → Cookies → copy the `session_id` value.
3. In VS Code: `Ctrl/Cmd+Shift+P` → **Quera: Sign In** → paste it.
   (The CSRF token prompt is optional — QueraCode scrapes a fresh one when needed.)

**Option B — username / password.**
1. Set `queracode.authMethod` to `usernamePassword` and fill `queracode.username`.
2. Run **Quera: Sign In** and enter the password (stored in SecretStorage).

The status bar shows `✓ Quera · submit off` once you're in. **Quera: Who Am I**
confirms the account.

## 2½. The Dashboard

QueraCode opens the **Quera Dashboard** on startup (`queracode.openDashboardOnStartup`) —
profile, college progress, classes, deadlines, contests, and one-click action
buttons, with a pulsing Quera logo while it loads. Reopen anytime with
`Ctrl/Cmd+Alt+D`.

## 3. Solve your first problem (learner)

1. Open the **QueraCode** activity-bar icon → **Problemset** view.
2. **Quera: Set Problemset Filters** (difficulty, tags, category, solve status,
   order…) or **Search Problems** (`Ctrl/Cmd+Alt+P`).
3. Click a problem → the statement opens in an RTL/Persian-aware panel.
4. **Quera: Solve Problem** → pick a language → a scaffold lands in
   `<workspace>/quera/problem-<id>/` with the statement alongside.
5. **Quera: Run Solution on Samples** (`Ctrl/Cmd+Alt+R`) — runs each sample in a
   Docker sandbox (`--network=none`, capped) and diffs outputs judge-style.
6. To submit for real: set `queracode.enableSubmission: true`, then
   **Quera: Submit Solution** (`Ctrl/Cmd+Alt+Enter`). Submitting consumes an
   attempt — QueraCode asks for confirmation and shows the file-type id it
   resolved from the problem's live `allowed_file_types`.
7. Watch the verdict in **My Submissions** → click for the per-test breakdown.

## 4. Read & author lessons

- **Courses & Lessons** view lists your colleges → chapters → lessons.
  Click any lesson to **read** it as rendered Markdown (RTL-aware).
- **Quera: New Lesson / New Problem** — skeletons in Quera's Markdown dialect.
- **Quera: Validate Markdown / Judge / Test Names / DevOps Image** — the same
  checks Quera's pipeline cares about, in a themed findings panel.
- Staff: **Quera: Edit Lesson** loads a lesson's stored Markdown;
  **Quera: Publish Lesson** lints and publishes it back (requires
  `queracode.enableWrite: true` — off by default).

## 5. Build judge test bundles

1. **Quera: Generate Test Inputs** — pick a shape (array, matrix, string, pairs,
   graph), get seeded, reproducible inputs.
2. Run your reference solution on each input for the expected outputs.
3. **Quera: Build Test Bundle (problem.zip)** — writes `in/inputN.txt`,
   `out/outputN.txt`, optional `tester.cpp`, and a `problem.zip` ready to upload
   on the problem's test-files page.
4. **Quera: Validate Test Bundle** double-checks naming/pairing/numbering.
   **Quera: Insert tester.cpp** gives the special-judge scaffold
   (`./tester <input> <jury> <user>`, exit 0 = accept).

## 6. Optional: AI assistance

1. **Quera AI: Configure AI Provider** → pick OpenRouter, OpenAI, Anthropic,
   Groq, DeepSeek, Gemini, AvalAI, local Ollama/LM Studio, … → paste the API key
   (SecretStorage; local providers need none).
2. **Quera AI: Generate Solution** drafts code into your workspace (it never
   submits); **Explain Problem**, **Review Submission**, and **Chat** render
   into the themed panel.

Settings: `queracode.ai.provider`, `queracode.ai.model`, `queracode.ai.baseUrl`.

## 7. Optional: coder agents (QueraMCP)

**Quera: Register QueraMCP for Coder Agents** writes `.vscode/mcp.json` so
MCP-capable agents (Copilot agent mode, Claude, …) get the sibling
[QueraMCP](../../quera-mcp/) server — 217 Quera tools — automatically.
**Quera: Solve with Coder Agent** copies a ready-made solving brief.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Sign in to Quera…" stays in the sidebar | Run **Quera: Sign In**; check the status bar. |
| 401/403 errors | The `session_id` expired or lacks permission — sign in again. |
| Reads fail / connection reset | Quera is geo-restricted; check that your network reaches quera.org. |
| "Submitting is disabled" | Set `queracode.enableSubmission: true` (and `readOnly: false`). |
| Samples print a command instead of running | `queracode.sandbox` is `none` or Docker is missing. |
| AI commands say "no API key" | Run **Quera AI: Configure AI Provider** again and store a key. |
