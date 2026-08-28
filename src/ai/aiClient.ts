import { Provider, resolveProvider } from "./providers";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  content: string;
  model: string;
  provider: string;
  usage?: unknown;
  finishReason?: string;
}

export class AiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "AiError";
  }
}

export interface AiConfig {
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  referer?: string;
  appTitle?: string;
}

export interface ChatRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export function buildChatRequest(
  provider: Provider,
  opts: { baseUrl: string; apiKey?: string; model: string; referer?: string; appTitle?: string },
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number
): ChatRequest {
  const base = opts.baseUrl.replace(/\/+$/, "");
  if (provider.api === "anthropic") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const convo = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
    const payload: Record<string, unknown> = {
      model: opts.model, max_tokens: maxTokens, temperature, messages: convo,
    };
    if (system) payload.system = system;
    return { url: `${base}/messages`, headers, body: JSON.stringify(payload) };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  if (provider.name === "openrouter") {
    headers["HTTP-Referer"] = opts.referer || "https://quera.org";
    headers["X-Title"] = opts.appTitle || "QueraCode";
  }
  return {
    url: `${base}/chat/completions`,
    headers,
    body: JSON.stringify({ model: opts.model, messages, temperature, max_tokens: maxTokens }),
  };
}

export function parseChatResponse(provider: Provider, data: any, fallbackModel: string): ChatResult {
  if (provider.api === "anthropic") {
    const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
    const content = blocks
      .filter((b) => b && b.type === "text")
      .map((b) => String(b.text ?? ""))
      .join("");
    return {
      content, model: data?.model || fallbackModel, provider: provider.name,
      usage: data?.usage, finishReason: data?.stop_reason,
    };
  }
  const choice = (data?.choices || [])[0] || {};
  const content = choice?.message?.content ?? choice?.text ?? "";
  return {
    content: String(content), model: data?.model || fallbackModel, provider: provider.name,
    usage: data?.usage, finishReason: choice?.finish_reason,
  };
}

export function extractCodeBlock(text: string): string {
  const m = /```[a-zA-Z0-9_+-]*\r?\n([\s\S]*?)```/.exec(text || "");
  return m ? m[1].trim() : (text || "").trim();
}

export class AiClient {
  readonly provider: Provider;
  private readonly baseUrl?: string;
  private readonly model?: string;

  constructor(private readonly cfg: AiConfig) {
    this.provider = resolveProvider(cfg.provider);
    this.baseUrl = cfg.baseUrl || this.provider.baseUrl;
    this.model = cfg.model || this.provider.defaultModel;
  }

  ensureReady(): void {
    if (!this.baseUrl) {
      throw new AiError(
        `No base URL for AI provider '${this.provider.name}'. Set "queracode.ai.baseUrl" (required for provider=custom).`);
    }
    if (this.provider.needsKey && !this.cfg.apiKey) {
      const envs = (this.provider.keyEnv || []).join(" or ");
      throw new AiError(
        `No API key for AI provider '${this.provider.name}'. Run "Quera AI: Configure AI Provider" to store one in SecretStorage` +
        (envs ? ` (or set ${envs} in the environment).` : "."));
    }
    if (!this.model) {
      throw new AiError(
        `No model configured for AI provider '${this.provider.name}'. Set "queracode.ai.model" or run "Quera AI: Configure AI Provider".`);
    }
  }

  private redact(message: string): string {
    return this.cfg.apiKey ? message.split(this.cfg.apiKey).join("[redacted]") : message;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    this.ensureReady();
    const model = opts.model || this.model!;
    const temperature = opts.temperature ?? this.cfg.temperature ?? 0.2;
    const maxTokens = opts.maxTokens ?? this.cfg.maxTokens ?? 2048;
    const req = buildChatRequest(
      this.provider,
      {
        baseUrl: this.baseUrl!, apiKey: this.cfg.apiKey, model,
        referer: this.cfg.referer, appTitle: this.cfg.appTitle,
      },
      messages, temperature, maxTokens);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs || 120000);
    let res: Response;
    try {
      res = await fetch(req.url, {
        method: "POST", headers: req.headers, body: req.body, signal: controller.signal,
      });
    } catch (err: any) {
      throw new AiError(this.redact(`AI request failed: ${err?.message || err}`));
    } finally {
      clearTimeout(timer);
    }
    const data = await this.decode(res);
    return parseChatResponse(this.provider, data, model);
  }

  private async decode(res: Response): Promise<any> {
    if (res.status >= 400) {
      let detail = "";
      try {
        const body: any = await res.json();
        detail = typeof body?.error?.message === "string" ? body.error.message : JSON.stringify(body).slice(0, 400);
      } catch {
        detail = "";
      }
      throw new AiError(
        this.redact(`AI provider returned HTTP ${res.status}${detail ? `: ${detail}` : "."}`), res.status);
    }
    let body: any;
    try {
      body = await res.json();
    } catch {
      throw new AiError("AI provider returned a non-JSON response.");
    }
    if (typeof body !== "object" || body === null) {
      throw new AiError("AI provider returned an unexpected response shape.");
    }
    return body;
  }
}
