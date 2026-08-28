export type AiApi = "openai" | "anthropic";

export interface Provider {
  name: string;
  label: string;
  api: AiApi;
  baseUrl?: string;
  defaultModel?: string;
  keyEnv?: string[];
  needsKey: boolean;
  notes?: string;
}

export const PROVIDERS: Provider[] = [
  {
    name: "openrouter", label: "OpenRouter", api: "openai",
    baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini",
    keyEnv: ["OPENROUTER_API_KEY"], needsKey: true,
    notes: "Unified gateway to 300+ models (OpenAI, Anthropic, Google, Llama, ...).",
  },
  {
    name: "openai", label: "OpenAI", api: "openai",
    baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini",
    keyEnv: ["OPENAI_API_KEY"], needsKey: true,
  },
  {
    name: "anthropic", label: "Anthropic (Claude)", api: "anthropic",
    baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-3-5-sonnet-latest",
    keyEnv: ["ANTHROPIC_API_KEY"], needsKey: true,
  },
  {
    name: "groq", label: "Groq", api: "openai",
    baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile",
    keyEnv: ["GROQ_API_KEY"], needsKey: true,
    notes: "Very fast inference for open models.",
  },
  {
    name: "together", label: "Together AI", api: "openai",
    baseUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    keyEnv: ["TOGETHER_API_KEY"], needsKey: true,
  },
  {
    name: "deepseek", label: "DeepSeek", api: "openai",
    baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat",
    keyEnv: ["DEEPSEEK_API_KEY"], needsKey: true,
    notes: "Strong coding/reasoning models (deepseek-chat, deepseek-reasoner).",
  },
  {
    name: "mistral", label: "Mistral AI", api: "openai",
    baseUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-large-latest",
    keyEnv: ["MISTRAL_API_KEY"], needsKey: true,
  },
  {
    name: "fireworks", label: "Fireworks AI", api: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    keyEnv: ["FIREWORKS_API_KEY"], needsKey: true,
  },
  {
    name: "xai", label: "xAI (Grok)", api: "openai",
    baseUrl: "https://api.x.ai/v1", defaultModel: "grok-2-latest",
    keyEnv: ["XAI_API_KEY"], needsKey: true,
  },
  {
    name: "perplexity", label: "Perplexity", api: "openai",
    baseUrl: "https://api.perplexity.ai", defaultModel: "sonar",
    keyEnv: ["PERPLEXITY_API_KEY"], needsKey: true,
    notes: "Web-grounded 'sonar' models.",
  },
  {
    name: "gemini", label: "Google Gemini", api: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-1.5-flash",
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], needsKey: true,
    notes: "Gemini via its OpenAI-compatible endpoint.",
  },
  {
    name: "avalai", label: "AvalAI", api: "openai",
    baseUrl: "https://api.avalai.ir/v1", defaultModel: "gpt-4o-mini",
    keyEnv: ["AVALAI_API_KEY"], needsKey: true,
    notes: "Iran-reachable OpenAI-compatible gateway — useful given Quera's geo-restriction.",
  },
  {
    name: "ollama", label: "Ollama (local)", api: "openai",
    baseUrl: "http://localhost:11434/v1", defaultModel: "llama3.1",
    keyEnv: [], needsKey: false,
    notes: "Local models; no API key required.",
  },
  {
    name: "lmstudio", label: "LM Studio (local)", api: "openai",
    baseUrl: "http://localhost:1234/v1", defaultModel: "local-model",
    keyEnv: [], needsKey: false,
    notes: "Local OpenAI-compatible server; no API key required.",
  },
  {
    name: "custom", label: "Custom (OpenAI-compatible)", api: "openai",
    keyEnv: ["QUERA_AI_API_KEY"], needsKey: false,
    notes: "Any OpenAI-compatible endpoint — set queracode.ai.baseUrl and queracode.ai.model.",
  },
];

export const DEFAULT_PROVIDER = "openrouter";

export function providerNames(): string[] {
  return PROVIDERS.map((p) => p.name);
}

export function resolveProvider(name?: string): Provider {
  const key = (name || DEFAULT_PROVIDER).trim().toLowerCase();
  const hit = PROVIDERS.find((p) => p.name === key);
  if (!hit) {
    const known = providerNames().sort().join(", ");
    throw new Error(`Unknown AI provider '${name}'. Known providers: ${known}.`);
  }
  return hit;
}

export function resolveEnvApiKey(provider: Provider): string | undefined {
  for (const env of provider.keyEnv || []) {
    const value = process.env[env];
    if (value) return value;
  }
  return undefined;
}
