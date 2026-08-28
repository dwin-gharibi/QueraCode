import * as assert from "assert";
import {
  DEFAULT_PROVIDER, PROVIDERS, providerNames, resolveProvider,
} from "../../src/ai/providers";
import {
  ChatMessage, buildChatRequest, extractCodeBlock, parseChatResponse,
} from "../../src/ai/aiClient";

describe("provider registry", () => {
  it("ships the HTTP presets only (no MCP 'host')", () => {
    const names = providerNames();
    for (const n of [
      "openrouter", "openai", "anthropic", "groq", "together", "deepseek", "mistral",
      "fireworks", "xai", "perplexity", "gemini", "avalai", "ollama", "lmstudio", "custom",
    ]) {
      assert.ok(names.includes(n), `missing provider ${n}`);
    }
    assert.ok(!names.includes("host"));
    assert.strictEqual(PROVIDERS.length, 15);
  });

  it("resolves case-insensitively and defaults to openrouter", () => {
    assert.strictEqual(resolveProvider(undefined).name, DEFAULT_PROVIDER);
    assert.strictEqual(resolveProvider("Anthropic").api, "anthropic");
    assert.strictEqual(resolveProvider(" OPENAI ").name, "openai");
    assert.throws(() => resolveProvider("nope"), /Unknown AI provider/);
  });

  it("marks local gateways and custom as keyless, hosted ones as keyed", () => {
    assert.strictEqual(resolveProvider("ollama").needsKey, false);
    assert.strictEqual(resolveProvider("lmstudio").needsKey, false);
    assert.strictEqual(resolveProvider("custom").needsKey, false);
    assert.strictEqual(resolveProvider("openai").needsKey, true);
    assert.strictEqual(resolveProvider("openrouter").needsKey, true);
  });

  it("has no base URL or default model for provider=custom", () => {
    const custom = resolveProvider("custom");
    assert.strictEqual(custom.baseUrl, undefined);
    assert.strictEqual(custom.defaultModel, undefined);
    assert.strictEqual(custom.api, "openai");
  });
});

describe("buildChatRequest", () => {
  const messages: ChatMessage[] = [
    { role: "system", content: "be brief" },
    { role: "user", content: "hi" },
  ];

  it("builds an OpenAI /chat/completions request", () => {
    const req = buildChatRequest(
      resolveProvider("openai"),
      { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", model: "gpt-4o-mini" },
      messages, 0.2, 100);
    assert.strictEqual(req.url, "https://api.openai.com/v1/chat/completions");
    assert.strictEqual(req.headers.Authorization, "Bearer sk-test");
    const body = JSON.parse(req.body);
    assert.strictEqual(body.model, "gpt-4o-mini");
    assert.deepStrictEqual(body.messages, messages);
    assert.strictEqual(body.temperature, 0.2);
    assert.strictEqual(body.max_tokens, 100);
  });

  it("adds the OpenRouter ranking headers", () => {
    const req = buildChatRequest(
      resolveProvider("openrouter"),
      { baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "m" },
      messages, 0, 1);
    assert.strictEqual(req.headers["HTTP-Referer"], "https://quera.org");
    assert.strictEqual(req.headers["X-Title"], "QueraCode");
    const other = buildChatRequest(
      resolveProvider("groq"),
      { baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m" },
      messages, 0, 1);
    assert.strictEqual(other.headers["HTTP-Referer"], undefined);
  });

  it("folds system messages into the Anthropic /messages shape", () => {
    const req = buildChatRequest(
      resolveProvider("anthropic"),
      { baseUrl: "https://api.anthropic.com/v1", apiKey: "k", model: "claude" },
      messages, 0.1, 64);
    assert.ok(req.url.endsWith("/messages"));
    assert.strictEqual(req.headers["x-api-key"], "k");
    assert.strictEqual(req.headers["anthropic-version"], "2023-06-01");
    assert.strictEqual(req.headers.Authorization, undefined);
    const body = JSON.parse(req.body);
    assert.strictEqual(body.system, "be brief");
    assert.deepStrictEqual(body.messages, [{ role: "user", content: "hi" }]);
    assert.strictEqual(body.max_tokens, 64);
  });

  it("omits auth headers when no key is set (local providers)", () => {
    const req = buildChatRequest(
      resolveProvider("ollama"),
      { baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
      messages, 0, 1);
    assert.strictEqual(req.headers.Authorization, undefined);
    assert.ok(!req.body.includes("Bearer"));
  });
});

describe("parseChatResponse", () => {
  it("reads the OpenAI choices shape", () => {
    const r = parseChatResponse(
      resolveProvider("openai"),
      { model: "gpt", choices: [{ message: { content: "hey" }, finish_reason: "stop" }], usage: { total_tokens: 5 } },
      "fallback");
    assert.strictEqual(r.content, "hey");
    assert.strictEqual(r.model, "gpt");
    assert.strictEqual(r.provider, "openai");
    assert.strictEqual(r.finishReason, "stop");
  });

  it("joins Anthropic text blocks and skips non-text ones", () => {
    const r = parseChatResponse(
      resolveProvider("anthropic"),
      { content: [{ type: "text", text: "a" }, { type: "tool_use" }, { type: "text", text: "b" }], stop_reason: "end_turn" },
      "m");
    assert.strictEqual(r.content, "ab");
    assert.strictEqual(r.finishReason, "end_turn");
  });

  it("falls back to the requested model on empty responses", () => {
    const r = parseChatResponse(resolveProvider("openai"), {}, "m");
    assert.strictEqual(r.model, "m");
    assert.strictEqual(r.content, "");
  });
});

describe("extractCodeBlock", () => {
  it("pulls the first fenced block", () => {
    assert.strictEqual(
      extractCodeBlock("intro\n```python\nprint(1)\n```\nrest\n```\nother\n```"),
      "print(1)");
  });

  it("returns trimmed text when there is no fence", () => {
    assert.strictEqual(extractCodeBlock("  x = 1  "), "x = 1");
    assert.strictEqual(extractCodeBlock(""), "");
  });
});
